import Link from "next/link";
import { docs } from "@/lib/docs";
import { createDocument } from "./actions";

export const dynamic = "force-dynamic";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(ms: number) {
  const minutes = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

export default async function Home() {
  const { documents } = await docs().listDocuments({ limit: 50 });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-5xl font-bold tracking-tight">SyncCraft</h1>
      <p className="mt-3 max-w-[46ch] text-lg text-ink-soft">
        Documents that several people can edit at once. Open one in two tabs and watch the cursors meet.
      </p>

      <form action={createDocument} className="mt-10 flex gap-3">
        <input
          name="title"
          placeholder="Name your document"
          maxLength={120}
          aria-label="Document name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-4 py-3 text-base placeholder:text-ink-soft/70"
        />
        <button
          type="submit"
          className="rounded-lg bg-saffron px-5 py-3 font-semibold text-ink hover:bg-[#f7bf45]"
        >
          New document
        </button>
      </form>

      <section className="mt-12" aria-labelledby="docs-heading">
        <h2 id="docs-heading" className="text-xl font-semibold">
          Your documents
        </h2>
        {documents.length === 0 ? (
          <p className="mt-4 text-ink-soft">Nothing here yet. Name a document above to start writing.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {documents.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/d/${d.id}`}
                  className="flex items-baseline justify-between gap-4 px-1 py-4 hover:bg-paper"
                >
                  <span className="truncate text-lg font-medium">{d.title}</span>
                  <span className="shrink-0 text-sm text-ink-soft">Edited {ago(d.updatedAtMs)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
