import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { docs } from "@/lib/docs";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { document } = await docs().getDocument({ id });
  if (!document) notFound();
  return <Workspace docId={document.id} title={document.title} />;
}
