import "server-only";
import { createChannel, createClient, type Client } from "nice-grpc";
import { DocumentServiceDefinition } from "@/gen/synccraft/v1/documents";

type DocsClient = Client<typeof DocumentServiceDefinition>;

// Keep one channel across hot reloads in dev.
const g = globalThis as unknown as { __synccraftDocs?: DocsClient };

/** Type-safe gRPC client for the document service (server components & actions only). */
export function docs(): DocsClient {
  if (!g.__synccraftDocs) {
    const channel = createChannel(process.env.DOC_SERVICE_ADDR ?? "localhost:50051");
    g.__synccraftDocs = createClient(DocumentServiceDefinition, channel);
  }
  return g.__synccraftDocs;
}
