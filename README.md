# SyncCraft – real-time collaborative workspace

Rich-text documents that many people edit at once, with live cursors and presence.

```
 Browser (Next.js 16 · React 19 · Tiptap 3 · Yjs)
   │  binary WebSocket  [type byte | payload]
   ▼
 Gateway (Go) ── Redis Pub/Sub ──► other gateway instances
   │  gRPC (batched updates, state load)
   ▼
 Document service (Node.js · TypeScript) ── Redis (compacted Yjs state + metadata)

 Next.js server ── gRPC ──► Document service   (create/list docs)
 Next.js server ── signs short-lived JWT ──► Gateway verifies it
```

| Piece | Tech | Job |
|---|---|---|
| `apps/web` | Next.js 16, TypeScript, Tiptap 3, Yjs, Tailwind 4 | UI, editor, custom Yjs provider, token endpoint |
| `services/gateway` | Go, `coder/websocket`, go-redis v9, gRPC | WebSocket relay: goroutine per connection, Redis Pub/Sub fan-out, presence cache, update batching |
| `services/doc` | Node 24, nice-grpc, Yjs, ioredis | Merges and stores Yjs updates, serves document state |
| `proto/` | Protocol Buffers + buf + ts-proto | Single source of truth; generates Go and TypeScript types |

## Run it

Prerequisites: Docker, Node 24+, and a `.env` file.

```bash
cp .env.example .env      # set JWT_SECRET (openssl rand -base64 32)
make up                   # generates code from proto/, then docker compose up --build
```

Open <http://localhost:3000>, create a document, then open it in a second window.

Native dev (hot reload): `make dev-redis`, then in separate shells
`cd services/doc && npm run dev`, `cd services/gateway && go run ./cmd/gateway`, `cd apps/web && npm run dev`
(set the env vars from `docker-compose.yml`; use `localhost` addresses).

## How sync works

- Each keystroke becomes a Yjs update (CRDT), sent as a binary frame. Updates commute, so concurrent edits converge without a central lock.
- The gateway publishes every frame on `sc:room:<doc>`; every gateway instance fans it out to its local sockets (the sender is skipped via a connection ID prefix).
- On connect the gateway sends the stored state plus its state vector. The client replies with only what the server lacks, so edits made offline merge cleanly on reconnect.
- Updates are batched (≈400 ms / 256 updates) into one `ApplyUpdates` gRPC call; the doc service merges them with `Y.mergeUpdates`.
- Presence/cursors are ephemeral: relayed immediately and cached in a Redis hash so late joiners see everyone. When a socket closes, the gateway broadcasts a removal so ghost cursors vanish instantly.

## Wire protocol

| Byte 0 | Direction | Payload |
|---|---|---|
| `0` update | both | Yjs update |
| `1` awareness | both | y-protocols awareness update |
| `2` state vector | server → client | Yjs state vector; client answers with a type `0` diff |

## Where to take it next

- Postgres (or S3 + Postgres) for document storage instead of Redis AOF; Redis Streams as a write-ahead log so the 400 ms batching window can't lose data on a gateway crash.
- Real user accounts and per-document roles (viewer/editor) in the JWT; rate limiting per connection.
- `y-indexeddb` for offline persistence across tab closes; document history/snapshots.
- OpenTelemetry traces + Prometheus metrics (connections, fan-out latency, batch sizes) and a load-test tool to back up latency claims with numbers.
- Shard `ApplyUpdates` by document ID if you run more than one doc-service replica (it serialises per document in-process today).

## Tests

`make test` runs the Go unit tests (awareness codec) and type-checks the TypeScript service.
