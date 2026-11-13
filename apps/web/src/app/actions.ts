"use server";

import { redirect } from "next/navigation";
import { docs } from "@/lib/docs";

export async function createDocument(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim() || "Untitled document";
  const { document } = await docs().createDocument({ title });
  if (!document) throw new Error("Document service returned no document");
  redirect(`/d/${document.id}`);
}
