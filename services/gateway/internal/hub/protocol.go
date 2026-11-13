package hub

// Wire protocol between browser and gateway. Every binary WebSocket message is
//
//	[1 byte type][payload]
//
// The gateway is a relay: it never needs to understand Yjs update contents.
const (
	// MsgUpdate carries a raw Yjs update (client -> server -> everyone else).
	MsgUpdate byte = 0
	// MsgAwareness carries a y-protocols awareness update (cursors, presence).
	MsgAwareness byte = 1
	// MsgStateVector is sent once by the server after connect. The client replies
	// with a MsgUpdate holding only what the server is missing.
	MsgStateVector byte = 2
)

func frame(t byte, payload []byte) []byte {
	out := make([]byte, 1+len(payload))
	out[0] = t
	copy(out[1:], payload)
	return out
}
