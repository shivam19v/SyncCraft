package hub

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"synccraft/gateway/internal/awareness"
)

const (
	persistInterval = 400 * time.Millisecond
	persistMaxBatch = 256
	awarenessTTL    = 90 * time.Second
)

// room is one document's live session on this gateway instance. All gateways
// serving the same document are joined together by a Redis Pub/Sub channel.
type room struct {
	docID   string
	channel string
	awKey   string
	hub     *Hub
	sub     *redis.PubSub

	mu      sync.RWMutex
	clients map[ID]*Client

	updates     chan []byte
	listenDone  chan struct{}
	persistDone chan struct{}
}

func newRoom(h *Hub, docID string) (*room, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	r := &room{
		docID:       docID,
		channel:     "sc:room:" + docID,
		awKey:       "sc:aw:" + docID,
		hub:         h,
		clients:     make(map[ID]*Client),
		updates:     make(chan []byte, 1024),
		listenDone:  make(chan struct{}),
		persistDone: make(chan struct{}),
	}
	r.sub = h.rdb.Subscribe(ctx, r.channel)
	// Wait for the server to confirm the subscription so no message is missed.
	if _, err := r.sub.Receive(ctx); err != nil {
		_ = r.sub.Close()
		return nil, err
	}
	go r.listen()
	go r.persist()
	return r, nil
}

// listen fans messages from Redis out to this instance's local clients.
func (r *room) listen() {
	defer close(r.listenDone)
	for m := range r.sub.Channel(redis.WithChannelSize(1024)) {
		p := m.Payload
		if len(p) <= len(ID{}) {
			continue
		}
		var origin ID
		copy(origin[:], p[:len(origin)])
		r.fanout(origin, []byte(p[len(origin):]))
	}
}

func (r *room) fanout(origin ID, msg []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, c := range r.clients {
		if id != origin {
			c.Send(msg)
		}
	}
}

func (r *room) publish(ctx context.Context, origin ID, msg []byte) {
	buf := make([]byte, len(origin)+len(msg))
	copy(buf, origin[:])
	copy(buf[len(origin):], msg)
	if err := r.hub.rdb.Publish(ctx, r.channel, buf).Err(); err != nil && ctx.Err() == nil {
		r.hub.log.Error("redis publish failed", "doc", r.docID, "err", err)
	}
}

func (r *room) enqueue(update []byte) {
	if len(update) > 0 {
		r.updates <- update
	}
}

// persist batches updates and hands them to the document service, so a burst of
// keystrokes becomes one gRPC call instead of hundreds.
func (r *room) persist() {
	defer close(r.persistDone)
	tick := time.NewTicker(persistInterval)
	defer tick.Stop()

	var batch [][]byte
	flush := func() {
		if len(batch) > 0 {
			r.apply(batch)
			batch = nil
		}
	}
	for {
		select {
		case u, ok := <-r.updates:
			if !ok {
				flush()
				return
			}
			batch = append(batch, u)
			if len(batch) >= persistMaxBatch {
				flush()
			}
		case <-tick.C:
			flush()
		}
	}
}

func (r *room) apply(batch [][]byte) {
	var err error
	for attempt := 0; attempt < 4; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err = r.hub.docs.ApplyUpdates(ctx, r.docID, batch)
		cancel()
		if err == nil {
			return
		}
		time.Sleep(200 * time.Millisecond << attempt)
	}
	r.hub.log.Error("persisting updates failed; they remain in connected clients", "doc", r.docID, "updates", len(batch), "err", err)
}

// trackAwareness mirrors presence into a Redis hash so clients joining through
// any gateway instance immediately see everyone who is already here.
func (r *room) trackAwareness(ctx context.Context, entries []awareness.Entry) {
	pipe := r.hub.rdb.Pipeline()
	for _, e := range entries {
		field := strconv.FormatUint(e.ClientID, 10)
		if e.IsRemoval() {
			pipe.HDel(ctx, r.awKey, field)
		} else {
			pipe.HSet(ctx, r.awKey, field, awareness.Encode([]awareness.Entry{e}))
		}
	}
	pipe.Expire(ctx, r.awKey, awarenessTTL)
	if _, err := pipe.Exec(ctx); err != nil && ctx.Err() == nil {
		r.hub.log.Warn("awareness cache write failed", "doc", r.docID, "err", err)
	}
}

func (r *room) awarenessSnapshot(ctx context.Context) []byte {
	vals, err := r.hub.rdb.HVals(ctx, r.awKey).Result()
	if err != nil || len(vals) == 0 {
		return nil
	}
	var all []awareness.Entry
	for _, v := range vals {
		if es, err := awareness.Decode([]byte(v)); err == nil {
			all = append(all, es...)
		}
	}
	if len(all) == 0 {
		return nil
	}
	return awareness.Encode(all)
}

// cleanupAwareness tells everyone that the client's presence is gone.
func (r *room) cleanupAwareness(c *Client) {
	if len(c.awClocks) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	removals := make([]awareness.Entry, 0, len(c.awClocks))
	for id, clock := range c.awClocks {
		removals = append(removals, awareness.Removal(id, clock))
	}
	r.trackAwareness(ctx, removals)
	r.publish(ctx, c.ID, frame(MsgAwareness, awareness.Encode(removals)))
}

func (r *room) close() {
	_ = r.sub.Close()
	<-r.listenDone
	close(r.updates) // safe: the room has no clients left to enqueue
	<-r.persistDone  // waits for the final flush
}
