package server

import (
	"context"
	"log/slog"
	"net/http"
	"regexp"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"

	"synccraft/gateway/internal/auth"
	"synccraft/gateway/internal/hub"
)

const maxMessageBytes = 16 << 20

var docIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type Server struct {
	hub      *hub.Hub
	verifier *auth.Verifier
	rdb      *redis.Client
	origins  []string
	log      *slog.Logger
}

func New(h *hub.Hub, v *auth.Verifier, rdb *redis.Client, origins []string, log *slog.Logger) *Server {
	return &Server{hub: h, verifier: v, rdb: rdb, origins: origins, log: log}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /ws/{docID}", s.handleWS)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.rdb.Ping(r.Context()).Err(); err != nil {
		http.Error(w, "redis unavailable", http.StatusServiceUnavailable)
		return
	}
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("docID")
	if !docIDPattern.MatchString(docID) {
		http.Error(w, "bad document id", http.StatusBadRequest)
		return
	}
	claims, err := s.verifier.Verify(r.URL.Query().Get("token"))
	if err != nil || claims.Doc != docID {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.origins})
	if err != nil {
		return // Accept has already written the HTTP error
	}
	conn.SetReadLimit(maxMessageBytes)

	c := hub.NewClient(conn, claims.Subject, claims.Name, s.log)
	s.hub.Serve(context.WithoutCancel(r.Context()), docID, c)
}
