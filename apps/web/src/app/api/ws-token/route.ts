import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import { docs } from "@/lib/docs";

export const runtime = "nodejs";

interface Body {
  docId?: string;
  user?: { id?: string; name?: string; color?: string };
}

/**
 * Mints a 60-second token that lets one browser open one WebSocket to the Go
 * gateway for one document. The gateway verifies it with the shared secret.
 */
export async function POST(req: Request) {
  const secret = process.env.JWT_SECRET;
  const gateway = process.env.GATEWAY_PUBLIC_URL;
  if (!secret || !gateway) {
    return NextResponse.json({ error: "Server is not configured" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const docId = body.docId ?? "";
  const user = body.user ?? {};
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(docId) || !user.id || !user.name) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { document } = await docs().getDocument({ id: docId });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const token = await new SignJWT({
    doc: docId,
    name: user.name.slice(0, 40),
    color: /^#[0-9a-fA-F]{6}$/.test(user.color ?? "") ? user.color : "#17bebb",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id.slice(0, 64))
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ token, url: gateway });
}
