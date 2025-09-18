/*
 * Cloudflare KV diagnostic: verifies the Worker binding "BRAIN" is reachable
 * and lists a small sample of keys. When executed in CI/Actions (Node.js), it
 * prints guidance and exits successfully.
 */

type KvListResult = {
  keys: Array<{ name: string }>;
};

type KvBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<KvListResult>;
};

declare const BRAIN: KvBinding | undefined;

type GlobalWithBrain = typeof globalThis & { BRAIN?: KvBinding };

async function diagnose(): Promise<void> {
  const globalBrain = (globalThis as GlobalWithBrain).BRAIN;

  if (!globalBrain) {
    console.log("[kv-diagnose] BRAIN binding unavailable (likely running in CI).");
    console.log("[kv-diagnose] Deploy the Worker or run `wrangler dev` to execute against KV.");
    if (typeof process !== "undefined") {
      process.exit(0);
    }
    return;
  }

  const pingKey = "__ping";
  let ping = await globalBrain.get(pingKey);
  if (!ping) {
    console.log(`[kv-diagnose] \"${pingKey}\" missing → writing sentinel.`);
    await globalBrain.put(pingKey, "ok");
    ping = await globalBrain.get(pingKey);
  }
  console.log(`[kv-diagnose] ${ping ? "Ping succeeded" : "Ping missing"}.`);

  const list = await globalBrain.list({ prefix: "brain:", limit: 10 });
  if (!list.keys.length) {
    console.log("[kv-diagnose] No keys found with prefix \"brain:\" (check data loads).");
    return;
  }

  console.log("[kv-diagnose] Sample keys (values redacted):");
  for (const { name } of list.keys) {
    console.log(`- ${name}`);
  }
}

diagnose().catch((error) => {
  console.error("[kv-diagnose] Unexpected error:", error instanceof Error ? error.message : error);
  if (typeof process !== "undefined") {
    process.exit(1);
  }
});

export {};
