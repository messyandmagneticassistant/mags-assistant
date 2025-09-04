# Ops Quickstart

## Apps Script inbound
Set your Gmail Apps Script WebApp to POST normalized messages to `https://assistant.messyandmagnetic.com/email/inbound`.

## Curl examples
```bash
# send reply
curl -XPOST https://assistant.messyandmagnetic.com/email/reply \
  -H 'content-type: application/json' \
  -d '{"to":"test@example.com","subject":"hi","text":"hello"}'

# save lead
curl -XPOST https://assistant.messyandmagnetic.com/outreach/lead \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","tags":["grant"]}'

# enqueue outreach
curl -XPOST https://assistant.messyandmagnetic.com/outreach/enqueue \
  -H 'content-type: application/json' \
  -d '{"leadId":"<id>","templateId":"intro"}'

# Notion sync
curl -XPOST https://assistant.messyandmagnetic.com/sync/notion \
  -H 'content-type: application/json' \
  -d '{"props":{"Name":{"title":[{"text":{"content":"Test"}}]}}}'

# Drive upload
curl -XPOST https://assistant.messyandmagnetic.com/sync/drive \
  -H 'content-type: application/json' \
  -d '{"path":"notes.txt","content":"hello"}'

# enqueue job
curl -XPOST https://assistant.messyandmagnetic.com/ops/enqueue \
  -H 'content-type: application/json' \
  -d '{"job":{"kind":"email_inbound","id":"x"}}'

# admin status
curl https://assistant.messyandmagnetic.com/admin/status
```

Maggie acts as you; respect opt-out and consent requirements.
