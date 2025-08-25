# Tally → Sheets test rigs

## Quiz test → Worker
```sh
curl -sS -X POST "$WORKER_URL/tally" \
  -H "Content-Type: application/json" \
  -d '{
    "form_id":"3qlZQ9",
    "submission_id":"quiz-test-'"$(date +%s)"'",
    "email":"test+quiz@example.com",
    "full_name":"Quiz Tester",
    "product_choice":"Blueprint",
    "score": 87,
    "result_tier":"Gold",
    "user_agent":"curl/test",
    "ip":"127.0.0.1"
  }'
```

## Feedback test → Worker
```sh
curl -sS -X POST "$WORKER_URL/tally" \
  -H "Content-Type: application/json" \
  -d '{
    "form_id":"nGPKDo",
    "submission_id":"fb-test-'"$(date +%s)"'",
    "email":"test+fb@example.com",
    "full_name":"Feedback Friend",
    "rating": 5,
    "feedback_text":"Love the quiz!",
    "user_agent":"curl/test",
    "ip":"127.0.0.1"
  }'
```

Acceptance: both rows land in the correct tabs; logs capture success.
