### Telegram
curl -s https://<preview>.vercel.app/api/telegram/test

### Diagnose (uses Gemini if GEMINI_API_KEY set)
curl -s "https://<preview>.vercel.app/api/diagnose?pass=${NEXT_PUBLIC_FETCH_PASS}"
