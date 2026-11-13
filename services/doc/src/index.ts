import { Redis } from "ioredis";
import { createServer } from "nice-grpc";
import { DocumentServiceDefinition } from "./gen/synccraft/v1/documents.js";
import { createDocumentService } from "./service.js";
import { DocumentStore } from "./store.js";

const port = Number(process.env.PORT ?? 50051);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
redis.on("error", (err) => console.error("[redis]", err.message));

const server = createServer({
  // Yjs documents can get large; the gRPC default of 4 MiB is too tight.
  "grpc.max_receive_message_length": 32 * 1024 * 1024,
  "grpc.max_send_message_length": 32 * 1024 * 1024,
});
server.add(DocumentServiceDefinition, createDocumentService(new DocumentStore(redis)));

await server.listen(`0.0.0.0:${port}`);
console.log(`[doc] gRPC listening on :${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    console.log(`[doc] ${signal}, shutting down`);
    await server.shutdown();
    redis.disconnect();
  });
}
