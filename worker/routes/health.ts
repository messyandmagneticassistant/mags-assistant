export async function onRequestGet() {
  return new Response(JSON.stringify({ ok:true, time:new Date().toISOString() }),
    { status:200, headers:{ "content-type":"application/json" }});
}
