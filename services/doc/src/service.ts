import { ServerError, Status } from "nice-grpc";
import type { DocumentServiceImplementation } from "./gen/synccraft/v1/documents.js";
import type { DocMeta, DocumentStore } from "./store.js";

const toProto = (m: DocMeta) => ({
  id: m.id,
  title: m.title,
  createdAtMs: m.createdAtMs,
  updatedAtMs: m.updatedAtMs,
});

const notFound = (id: string) => new ServerError(Status.NOT_FOUND, `document ${id} not found`);

export function createDocumentService(store: DocumentStore): DocumentServiceImplementation {
  return {
    async createDocument(request) {
      return { document: toProto(await store.create(request.title)) };
    },

    async getDocument(request) {
      const meta = await store.get(request.id);
      return { document: meta ? toProto(meta) : undefined };
    },

    async listDocuments(request) {
      const docs = await store.list(request.limit > 0 ? Math.min(request.limit, 200) : 50);
      return { documents: docs.map(toProto) };
    },

    async getDocumentState(request) {
      const state = await store.getState(request.docId);
      if (!state) throw notFound(request.docId);
      return { stateUpdate: state.update, stateVector: state.vector };
    },

    async applyUpdates(request) {
      const result = await store.applyUpdates(request.docId, request.updates);
      if (!result) throw notFound(request.docId);
      return result;
    },
  };
}
