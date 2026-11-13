import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import * as Y from "yjs";

export interface DocMeta {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DocState {
  update: Uint8Array;
  vector: Uint8Array;
}

const INDEX_KEY = "sc:docs";
const metaKey = (id: string) => `sc:doc:${id}:meta`;
const stateKey = (id: string) => `sc:doc:${id}:state`;

/** State vector of an empty Y.Doc. */
const EMPTY_VECTOR = new Uint8Array([0]);

function parseMeta(h: Record<string, string>): DocMeta | null {
  if (!h.id) return null;
  return {
    id: h.id,
    title: h.title ?? "Untitled",
    createdAtMs: Number(h.createdAtMs ?? 0),
    updatedAtMs: Number(h.updatedAtMs ?? 0),
  };
}

/**
 * Redis-backed document store.
 *
 * Document content is stored as a single *compacted* Yjs update. New updates are
 * merged into it with `Y.mergeUpdates`, which works on the binary encoding and
 * never has to materialise a full Y.Doc in memory.
 */
export class DocumentStore {
  /** Per-document promise chain so merges for one document never interleave. */
  private tails = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: Redis) {}

  async create(title: string): Promise<DocMeta> {
    const now = Date.now();
    const meta: DocMeta = {
      id: randomBytes(6).toString("base64url"),
      title: title.trim().slice(0, 120) || "Untitled",
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.redis
      .multi()
      .hset(metaKey(meta.id), { ...meta })
      .zadd(INDEX_KEY, now, meta.id)
      .exec();
    return meta;
  }

  async get(id: string): Promise<DocMeta | null> {
    return parseMeta(await this.redis.hgetall(metaKey(id)));
  }

  async list(limit: number): Promise<DocMeta[]> {
    const ids = await this.redis.zrevrange(INDEX_KEY, 0, Math.max(1, limit) - 1);
    if (ids.length === 0) return [];
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.hgetall(metaKey(id));
    const rows = (await pipe.exec()) ?? [];
    return rows
      .map(([, value]) => parseMeta(value as Record<string, string>))
      .filter((m): m is DocMeta => m !== null);
  }

  /** Returns null if the document does not exist. */
  async getState(id: string): Promise<DocState | null> {
    if (!(await this.redis.exists(metaKey(id)))) return null;
    const stored = await this.redis.getBuffer(stateKey(id));
    if (!stored || stored.length === 0) {
      return { update: new Uint8Array(), vector: EMPTY_VECTOR };
    }
    return { update: stored, vector: Y.encodeStateVectorFromUpdate(stored) };
  }

  /** Returns null if the document does not exist. */
  async applyUpdates(
    id: string,
    updates: Uint8Array[],
  ): Promise<{ applied: number; rejected: number } | null> {
    return this.serialize(id, async () => {
      if (!(await this.redis.exists(metaKey(id)))) return null;

      // Reject malformed updates individually so one bad client can't poison a batch.
      const valid: Uint8Array[] = [];
      for (const u of updates) {
        try {
          Y.encodeStateVectorFromUpdate(u);
          valid.push(u);
        } catch {
          /* counted as rejected below */
        }
      }
      const rejected = updates.length - valid.length;
      if (valid.length === 0) return { applied: 0, rejected };

      const existing = await this.redis.getBuffer(stateKey(id));
      const merged = Y.mergeUpdates(existing?.length ? [existing, ...valid] : valid);
      const now = Date.now();
      await this.redis
        .multi()
        .set(stateKey(id), Buffer.from(merged))
        .hset(metaKey(id), "updatedAtMs", String(now))
        .zadd(INDEX_KEY, now, id)
        .exec();
      return { applied: valid.length, rejected };
    });
  }

  private serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(id) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => undefined);
    this.tails.set(id, tail);
    void tail.then(() => {
      if (this.tails.get(id) === tail) this.tails.delete(id);
    });
    return run;
  }
}
