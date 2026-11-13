package hub

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"

	"synccraft/gateway/internal/docs"
)

// DocStore is the subset of the document service the hub depends on.
type DocStore interface {
	GetState(ctx context.Context, docID string) (update, vector []byte, err error)
	ApplyUpdates(ctx context.Context, docID string, updates [][]byte) error
}

type Hub struct {
	rdb  *redis.Client
	docs DocStore
	log  *slog.Logger

	mu    sync.Mutex
	rooms map[string]*room
	wg    sync.WaitGroup
}

func New(rdb *redis.Client, store DocStore, log *slog.Logger) *Hub {
	return &Hub{rdb: rdb, docs: store, log: log, rooms: make(map[string]*room)}
}

// Serve runs one connection to completion. It blocks until the client leaves.
func (h *Hub) Serve(ctx context.Context, docID string, c *Client) {
	h.wg.Add(1)
	defer h.wg.Done()

	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	defer cancel()
	defer c.conn.Close(websocket.StatusNormalClosure, "")

	r, err := h.join(docID, c)
	if err != nil {
		c.log.Error("join failed", "doc", docID, "err", err)
		_ = c.conn.Close(websocket.StatusInternalError, "unavailable")
		return
	}
	defer h.leave(r, c)

	go c.writeLoop(ctx)
	if !h.bootstrap(ctx, r, c) {
		return
	}
	c.log.Info("joined", "doc", docID, "name", c.Name)
	c.readLoop(ctx, r)
	c.log.Info("left", "doc", docID)
}

// bootstrap sends the persisted document state plus current presence.
func (h *Hub) bootstrap(ctx context.Context, r *room, c *Client) bool {
	sctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	update, vector, err := h.docs.GetState(sctx, r.docID)
	if err != nil {
		if errors.Is(err, docs.ErrNotFound) {
			_ = c.conn.Close(websocket.StatusPolicyViolation, "unknown document")
		} else {
			c.log.Error("loading document state failed", "doc", r.docID, "err", err)
			_ = c.conn.Close(websocket.StatusTryAgainLater, "document service unavailable")
		}
		return false
	}
	if len(update) > 0 {
		c.Send(frame(MsgUpdate, update))
	}
	c.Send(frame(MsgStateVector, vector))
	if snap := r.awarenessSnapshot(sctx); snap != nil {
		c.Send(frame(MsgAwareness, snap))
	}
	return true
}

func (h *Hub) join(docID string, c *Client) (*room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[docID]
	if !ok {
		var err error
		if r, err = newRoom(h, docID); err != nil {
			return nil, err
		}
		h.rooms[docID] = r
	}
	r.mu.Lock()
	r.clients[c.ID] = c
	r.mu.Unlock()
	return r, nil
}

func (h *Hub) leave(r *room, c *Client) {
	r.cleanupAwareness(c)

	h.mu.Lock()
	r.mu.Lock()
	delete(r.clients, c.ID)
	empty := len(r.clients) == 0
	r.mu.Unlock()
	if empty {
		delete(h.rooms, r.docID)
	}
	h.mu.Unlock()

	if empty {
		r.close()
	}
}

// Shutdown disconnects every client and waits for rooms to flush to storage.
func (h *Hub) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	for _, r := range h.rooms {
		r.mu.RLock()
		for _, c := range r.clients {
			c.cancel()
		}
		r.mu.RUnlock()
	}
	h.mu.Unlock()

	done := make(chan struct{})
	go func() { h.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
