package awareness

import "testing"

func TestRoundTrip(t *testing.T) {
	in := []Entry{
		{ClientID: 4_000_000_123, Clock: 7, State: []byte(`{"user":{"name":"Ada"}}`)},
		Removal(42, 9),
	}
	out, err := Decode(Encode(in))
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || out[0].ClientID != in[0].ClientID || string(out[0].State) != string(in[0].State) {
		t.Fatalf("unexpected decode result: %+v", out)
	}
	if !out[1].IsRemoval() || out[1].Clock != 10 {
		t.Fatalf("removal entry wrong: %+v", out[1])
	}
}

func TestMalformed(t *testing.T) {
	good := Encode([]Entry{{ClientID: 1, Clock: 1, State: []byte(`{}`)}})
	for i := 0; i < len(good); i++ {
		if _, err := Decode(good[:i]); err == nil {
			t.Fatalf("truncated input of %d bytes decoded without error", i)
		}
	}
}
