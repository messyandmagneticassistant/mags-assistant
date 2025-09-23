import type { KVNamespace } from "@cloudflare/workers-types";
import { parseSubmission } from "../../src/forms/schema";
import { enqueueFulfillmentJob } from "../../src/queue";

interface Env {
  TALLY_SIGNING_SECRET?: string;
  BRAIN: KVNamespace;
}

async function verifySignature(raw: string, req: Request, secret: string): Promise<boolean> {
  const sig = req.headers.get("tally-signature");
  if (!sig) return false;
  const [tPart, v1Part] = sig.split(",");
  const timestamp = tPart?.split("=")[1];
  const v1 = v1Part?.split("=")[1];
  if (!timestamp || !v1) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
    name: "HMAC",
    hash: "SHA-256",
  }, false, ["sign"]);
  const data = enc.encode(`${timestamp}.${raw}`);
  const sigBuf = await crypto.subtle.sign("HMAC", key, data);
  const hex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === v1;
}

function parseSubmissionForOrder(body: any) {
  const formId = body.formId || body.form_id || "";
  return parseSubmission(formId, body);
}

export async function onRequestPost(ctx: any) {
  const { request, env } = ctx;
  const secret = env.TALLY_SIGNING_SECRET;
  const raw = await request.text();

  if (secret) {
    const ok = await verifySignature(raw, request, secret);
    if (!ok) return new Response("bad signature", { status: 401 });
  }

  const body = JSON.parse(raw || "{}");
  const parsed = parseSubmissionForOrder(body);
  const ctxObj = { ...parsed, env };

  await enqueueFulfillmentJob(
    {
      source: "tally",
      payload: body,
      metadata: { formId: parsed.productId || body.formId },
    },
    env
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
