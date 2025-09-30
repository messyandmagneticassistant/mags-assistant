function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const KEYS = ['blueprint:cohorts', 'blueprint:products', 'blueprint:tally'];

export async function onRequestGet({ env }: { env: any }) {
  const out: Record<string, any> = {};
  for (const k of KEYS) {
    try {
      const v = await env.BRAIN.get(k);
      out[k.split(':')[1]] = v ? JSON.parse(v) : {};
    } catch {
      out[k.split(':')[1]] = {};
    }
  }
  out.forms = {
    "Blueprint Intro": env.TALLY_BLUEPRINT_INTRO_ID || "",
    "Blueprint Full": env.TALLY_BLUEPRINT_FULL_ID || "",
    "Family Bundle": env.TALLY_BLUEPRINT_FAMILY_ID || "",
  };
  out.products = {
    intro: "prod_blueprint_intro",
    full: "prod_blueprint_full",
    family: "prod_blueprint_family",
  };
  return json(out);
}

export async function onRequestPost({ env, request }: { env: any; request: Request }) {
  if (request.headers.get('x-api-key') !== env.POST_THREAD_SECRET) return json({ ok: false, error: 'unauthorized' }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  for (const k of KEYS) {
    if (body[k.split(':')[1]] !== undefined) {
      await env.BRAIN.put(k, JSON.stringify(body[k.split(':')[1]]));
    }
  }
  return json({ ok: true });
}
