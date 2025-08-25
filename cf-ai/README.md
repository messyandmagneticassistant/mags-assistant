# mags-brain Worker

Cloudflare Worker using Workers AI to analyze TikTok text and rank clip ideas. It also exposes configs stored in KV.

## Usage

Replace `<subdomain>` with your Workers subdomain.

```bash
curl -X POST https://mags-brain.<subdomain>.workers.dev/analyze \
  -H "Content-Type: application/json" \
  -d '{"text":"Somebody’s mad you’re not suffering…"}'

curl -X POST https://mags-brain.<subdomain>.workers.dev/rank \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":"clip1","desc":"Dating is exhausting but here’s my 10s trick…"}]}'
```
