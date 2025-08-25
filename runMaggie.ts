import { decode } from "base64-arraybuffer";

export async function loadSecretsFromBlob(): Promise<Record<string, any>> {
  const blobKey = "SECRET_BLOB"; // ⬅️ this is the actual key in your KV now

  const CLOUDFLARE_ACCOUNT_ID = "5ff52dc210a86ff34a0dd3664bacb237";
  const CLOUDFLARE_NAMESPACE_ID = "1b8cbbc4a2f8426194368cb39baded79";
  const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "vMfaaWOMCYy6KHiaH-xy_vkTDxOaSpiznS0aSR0I";

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_NAMESPACE_ID}/values/${blobKey}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch KV blob: ${response.statusText}`);
  }

  const encoded = await response.text();

  try {
    const decoded = decode(encoded);
    const json = new TextDecoder().decode(decoded);
    const parsed = JSON.parse(json);
    return parsed;
  } catch (err) { 
    throw new Error("Could not decode or parse blob: " + err);
  }
}