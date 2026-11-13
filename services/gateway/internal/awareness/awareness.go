// Package awareness implements just enough of the y-protocols awareness wire
// format for the gateway to track which client IDs a connection owns, cache the
// latest presence per client, and synthesise "removed" updates on disconnect.
//
// Wire format (lib0 varints are plain LEB128, i.e. encoding/binary uvarints):
//
//	varUint count
//	count × { varUint clientID, varUint clock, varString json }
package awareness

import (
	"encoding/binary"
	"errors"
)

const maxEntries = 1024

var ErrMalformed = errors.New("awareness: malformed update")

type Entry struct {
	ClientID uint64
	Clock    uint64
	State    []byte // raw JSON; the literal `null` means "client went away"
}

func (e Entry) IsRemoval() bool { return string(e.State) == "null" }

// Removal builds the entry other clients need to drop a departed peer.
func Removal(clientID, lastClock uint64) Entry {
	return Entry{ClientID: clientID, Clock: lastClock + 1, State: []byte("null")}
}

func Decode(b []byte) ([]Entry, error) {
	n, k := binary.Uvarint(b)
	if k <= 0 || n > maxEntries {
		return nil, ErrMalformed
	}
	b = b[k:]
	entries := make([]Entry, 0, n)
	for i := uint64(0); i < n; i++ {
		id, k := binary.Uvarint(b)
		if k <= 0 {
			return nil, ErrMalformed
		}
		b = b[k:]
		clock, k := binary.Uvarint(b)
		if k <= 0 {
			return nil, ErrMalformed
		}
		b = b[k:]
		l, k := binary.Uvarint(b)
		if k <= 0 || l > uint64(len(b)-k) {
			return nil, ErrMalformed
		}
		b = b[k:]
		state := make([]byte, l)
		copy(state, b[:l])
		b = b[l:]
		entries = append(entries, Entry{ClientID: id, Clock: clock, State: state})
	}
	return entries, nil
}

func Encode(entries []Entry) []byte {
	out := binary.AppendUvarint(nil, uint64(len(entries)))
	for _, e := range entries {
		out = binary.AppendUvarint(out, e.ClientID)
		out = binary.AppendUvarint(out, e.Clock)
		out = binary.AppendUvarint(out, uint64(len(e.State)))
		out = append(out, e.State...)
	}
	return out
}
