import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";

/** Wire protocol shared with services/gateway/internal/hub/protocol.go */
const MSG_UPDATE = 0;
const MSG_AWARENESS = 1;
const MSG_STATE_VECTOR = 2;

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface Endpoint {
  /** e.g. ws://localhost:8080 */
  url: string;
  token: string;
}

export interface GatewayProviderOptions {
  docId: string;
  doc: Y.Doc;
  /** Called before every (re)connect so each attempt gets a fresh short-lived token. */
  connect: () => Promise<Endpoint>;
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/**
 * Yjs provider for the SyncCraft Go gateway.
 *
 *  - Document edits and cursor/presence flow as binary WebSocket frames.
 *  - On every (re)connect the server sends its state vector; we answer with only
 *    the changes it lacks, so edits made offline are merged without conflicts.
 */
export class GatewayProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private readonly opts: GatewayProviderOptions;
  private ws: WebSocket | null = null;
  private _status: ConnectionStatus = "connecting";
  private listeners = new Set<() => void>();
  private attempts = 0;
  private opening = false;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: GatewayProviderOptions) {
    this.opts = opts;
    this.doc = opts.doc;
    this.awareness = new Awareness(opts.doc);

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);

    void this.open();
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  /** Compatible with React's useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    this.awareness.destroy();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  // ---- connection lifecycle -------------------------------------------------

  private async open() {
    if (this.destroyed || this.opening || this.ws) return;
    this.opening = true;
    this.setStatus(this.attempts === 0 ? "connecting" : "reconnecting");

    let endpoint: Endpoint;
    try {
      endpoint = await this.opts.connect();
    } catch {
      this.opening = false;
      this.scheduleReconnect();
      return;
    }
    this.opening = false;
    if (this.destroyed) return;

    const url = `${endpoint.url}/ws/${encodeURIComponent(this.opts.docId)}?token=${encodeURIComponent(endpoint.token)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus("connected");
      // Announce ourselves; the server replies with state + everyone else's presence.
      if (this.awareness.getLocalState() !== null) {
        this.sendAwareness([this.doc.clientID]);
      }
    };
    ws.onmessage = (event) => this.onMessage(new Uint8Array(event.data as ArrayBuffer));
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropRemotePeers();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.attempts += 1;
    this.setStatus(navigator.onLine ? "reconnecting" : "offline");
    // Exponential backoff with jitter, capped at 15s.
    const base = Math.min(15_000, 500 * 2 ** Math.min(this.attempts, 5));
    const delay = base * (0.5 + Math.random() * 0.5);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.open(), delay);
  }

  private onOnline = () => {
    if (this.ws || this.opening) return;
    clearTimeout(this.timer);
    void this.open();
  };

  private onOffline = () => {
    if (!this.ws) this.setStatus("offline");
  };

  private setStatus(status: ConnectionStatus) {
    if (status === this._status) return;
    this._status = status;
    this.listeners.forEach((l) => l());
  }

  // ---- inbound --------------------------------------------------------------

  private onMessage(data: Uint8Array) {
    const payload = data.subarray(1);
    switch (data[0]) {
      case MSG_UPDATE:
        Y.applyUpdate(this.doc, payload, this);
        break;
      case MSG_AWARENESS:
        applyAwarenessUpdate(this.awareness, payload, this);
        break;
      case MSG_STATE_VECTOR: {
        // Send only what the server is missing (also flushes offline edits).
        const diff = Y.encodeStateAsUpdate(this.doc, payload);
        this.send(MSG_UPDATE, diff);
        break;
      }
    }
  }

  // ---- outbound -------------------------------------------------------------

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // came from the server
    this.send(MSG_UPDATE, update);
  };

  private onAwarenessUpdate = ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
    if (origin === this) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };

  private sendAwareness(clients: number[]) {
    this.send(MSG_AWARENESS, encodeAwarenessUpdate(this.awareness, clients));
  }

  private send(type: number, payload: Uint8Array) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return; // resynced on reconnect
    const out = new Uint8Array(payload.length + 1);
    out[0] = type;
    out.set(payload, 1);
    ws.send(out);
  }

  private dropRemotePeers() {
    const remote = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    removeAwarenessStates(this.awareness, remote, this);
  }
}
