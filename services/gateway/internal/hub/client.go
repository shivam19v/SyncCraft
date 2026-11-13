package hub

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"time"

	"github.com/coder/websocket"

	"synccraft/gateway/internal/awareness"
)

// ID uniquely identifies one connection; it is prefixed to every Redis message
// so each gateway can skip echoing a message back to its sender.
type ID [16]byte

func newID() ID {
	var id ID
	_, _ = rand.Read(id[:])
	return id
}

type Client struct {
	ID     ID
	UserID string
	Name   string

	conn   *websocket.Conn
	send   chan []byte
	cancel context.CancelFunc
	log    *slog.Logger

	// Latest awareness clock per Yjs client ID owned by this connection.
	// Only touched from the read loop and from leave (after the read loop ends).
	awClocks map[uint64]uint64
}

func NewClient(conn *websocket.Conn, userID, name string, log *slog.Logger) *Client {
	id := newID()
	return &Client{
		ID:       id,
		UserID:   userID,
		Name:     name,
		conn:     conn,
		send:     make(chan []byte, 256),
		awClocks: make(map[uint64]uint64),
		log:      log.With("conn", hex.EncodeToString(id[:4]), "user", userID),
	}
}

// Send enqueues a frame without ever blocking the caller. A client that cannot
// keep up is disconnected; it will resync from the document service on retry.
func (c *Client) Send(b []byte) {
	select {
	case c.send <- b:
	default:
		c.log.Warn("slow consumer, disconnecting")
		c.cancel()
	}
}

func (c *Client) writeLoop(ctx context.Context) {
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case b := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.conn.Write(wctx, websocket.MessageBinary, b)
			cancel()
			if err != nil {
				c.cancel()
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.conn.Ping(pctx)
			cancel()
			if err != nil {
				c.cancel()
				return
			}
		}
	}
}

func (c *Client) readLoop(ctx context.Context, r *room) {
	defer c.cancel()
	for {
		typ, data, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageBinary || len(data) == 0 {
			continue
		}
		switch data[0] {
		case MsgUpdate:
			r.publish(ctx, c.ID, data)
			r.enqueue(data[1:])
		case MsgAwareness:
			entries, err := awareness.Decode(data[1:])
			if err != nil {
				c.log.Debug("dropping malformed awareness update")
				continue
			}
			for _, e := range entries {
				c.awClocks[e.ClientID] = e.Clock
			}
			r.trackAwareness(ctx, entries)
			r.publish(ctx, c.ID, data)
		}
	}
}
