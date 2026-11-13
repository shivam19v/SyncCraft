"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { GatewayProvider, type ConnectionStatus } from "@/lib/gateway-provider";
import { createIdentity, loadIdentity, suggestName, type Identity } from "@/lib/identity";

/** Entry point: make sure we know who the person is, then open the session. */
export function Workspace({ docId, title }: { docId: string; title: string }) {
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  useEffect(() => setIdentity(loadIdentity()), []);

  if (identity === undefined) return <Shell title={title} />;
  if (identity === null) return <NameGate onDone={(name) => setIdentity(createIdentity(name))} />;
  return <Session docId={docId} title={title} identity={identity} />;
}

function NameGate({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [placeholder] = useState(suggestName);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-bold tracking-tight">What should collaborators call you?</h1>
      <p className="mt-2 text-ink-soft">Your name appears next to your cursor.</p>
      <form
        className="mt-6 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(name || placeholder);
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          maxLength={40}
          aria-label="Your name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-4 py-3"
        />
        <button className="rounded-lg bg-saffron px-5 py-3 font-semibold hover:bg-[#f7bf45]">Start writing</button>
      </form>
    </main>
  );
}

interface Live {
  ydoc: Y.Doc;
  provider: GatewayProvider;
}

/** Owns the Yjs doc + gateway connection for the lifetime of the page. */
function Session({ docId, title, identity }: { docId: string; title: string; identity: Identity }) {
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new GatewayProvider({
      docId,
      doc: ydoc,
      connect: async () => {
        const res = await fetch("/api/ws-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docId, user: identity }),
        });
        if (!res.ok) throw new Error(`token request failed: ${res.status}`);
        return (await res.json()) as { token: string; url: string };
      },
    });
    setLive({ ydoc, provider });
    return () => {
      provider.destroy();
      ydoc.destroy();
      setLive(null);
    };
  }, [docId, identity]);

  if (!live) return <Shell title={title} />;
  return <EditorScreen title={title} identity={identity} {...live} />;
}

function EditorScreen({
  title,
  identity,
  ydoc,
  provider,
}: Live & { title: string; identity: Identity }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }), // Yjs provides collaborative undo/redo
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({ provider, user: { name: identity.name, color: identity.color } }),
    ],
    editorProps: {
      attributes: { "aria-label": `Editing ${title}` },
    },
  });

  const status = useSyncExternalStore(
    provider.subscribe,
    () => provider.status,
    () => "connecting" as ConnectionStatus,
  );

  return (
    <Shell title={title} right={<><Peers provider={provider} /><StatusPill status={status} /></>}>
      <Toolbar editor={editor} />
      <div className="doc-surface px-8 py-10 sm:px-14">
        <EditorContent editor={editor} />
      </div>
    </Shell>
  );
}

function Shell({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-ground/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <Link href="/" className="rounded-md px-2 py-1 text-sm font-medium text-ink-soft hover:bg-paper">
            All documents
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-4">{right}</div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-0 py-6 sm:px-4">
        <article className="min-h-[70vh] overflow-hidden rounded-xl border border-line bg-paper">{children}</article>
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  const label = {
    connected: "Live",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    offline: "Offline – edits sync when you reconnect",
  }[status];
  const dot = status === "connected" ? "bg-[#2f9e6a]" : status === "offline" ? "bg-[#c0392b]" : "bg-saffron";
  return (
    <span role="status" className="flex items-center gap-2 text-sm text-ink-soft">
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

interface Peer {
  id: number;
  name: string;
  color: string;
  self: boolean;
}

function Peers({ provider }: { provider: GatewayProvider }) {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    const { awareness, doc } = provider;
    const update = () => {
      const next: Peer[] = [];
      awareness.getStates().forEach((state, id) => {
        const user = state.user as { name?: string; color?: string } | undefined;
        if (user?.name) next.push({ id, name: user.name, color: user.color ?? "#566660", self: id === doc.clientID });
      });
      setPeers(next);
    };
    update();
    awareness.on("change", update);
    return () => awareness.off("change", update);
  }, [provider]);

  return (
    <ul className="flex -space-x-2" aria-label={`${peers.length} people in this document`}>
      {peers.map((p) => (
        <li
          key={p.id}
          title={p.self ? `${p.name} (you)` : p.name}
          style={{ backgroundColor: p.color }}
          className="flex size-8 items-center justify-center rounded-full border-2 border-ground text-xs font-bold text-white"
        >
          {p.name.slice(0, 1).toUpperCase()}
        </li>
      ))}
    </ul>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        strike: e.isActive("strike"),
        h1: e.isActive("heading", { level: 1 }),
        h2: e.isActive("heading", { level: 2 }),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        quote: e.isActive("blockquote"),
        code: e.isActive("codeBlock"),
      },
  });
  if (!editor || !s) return <div className="h-12 border-b border-line" />;

  const run = (fn: () => boolean) => () => void fn();
  const chain = () => editor.chain().focus();

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
      <Btn on={s.bold} label="Bold" onClick={run(() => chain().toggleBold().run())}><b>B</b></Btn>
      <Btn on={s.italic} label="Italic" onClick={run(() => chain().toggleItalic().run())}><i>I</i></Btn>
      <Btn on={s.strike} label="Strikethrough" onClick={run(() => chain().toggleStrike().run())}><s>S</s></Btn>
      <Sep />
      <Btn on={s.h1} label="Heading 1" onClick={run(() => chain().toggleHeading({ level: 1 }).run())}>H1</Btn>
      <Btn on={s.h2} label="Heading 2" onClick={run(() => chain().toggleHeading({ level: 2 }).run())}>H2</Btn>
      <Sep />
      <Btn on={s.bullet} label="Bulleted list" onClick={run(() => chain().toggleBulletList().run())}>Bullets</Btn>
      <Btn on={s.ordered} label="Numbered list" onClick={run(() => chain().toggleOrderedList().run())}>Numbers</Btn>
      <Btn on={s.quote} label="Quote" onClick={run(() => chain().toggleBlockquote().run())}>Quote</Btn>
      <Btn on={s.code} label="Code block" onClick={run(() => chain().toggleCodeBlock().run())}>Code</Btn>
      <Sep />
      <Btn label="Undo" onClick={run(() => chain().undo().run())}>Undo</Btn>
      <Btn label="Redo" onClick={run(() => chain().redo().run())}>Redo</Btn>
    </div>
  );
}

function Btn({
  on,
  label,
  onClick,
  children,
}: {
  on?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`min-w-9 rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-ground ${on ? "bg-ink text-paper hover:bg-ink" : ""}`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden className="mx-1 my-1 w-px bg-line" />;
