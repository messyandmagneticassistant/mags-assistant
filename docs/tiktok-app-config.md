# TikTok App Config

- **App Name:** Messy & Magnetic
- **Website:** https://messyandmagnetic.com
- **Callback URL:** https://messyandmagnetic.com/auth/tiktok/callback/
- **Privacy Policy:** https://messyandmagnetic.com/privacy
- **Verification:** File `tiktok_verification.html`
- **Scopes:** `user.info.profile`, `user.info.stats`, `video.list`
- **Endpoints:**
  - Callback: https://messyandmagnetic.com/auth/tiktok/callback/
  - User: https://messyandmagnetic.com/api/tiktok/user
  - Video: https://messyandmagnetic.com/api/tiktok/video
- **Demo Flow:**
  1. User clicks **Connect TikTok** on messyandmagnetic.com.
  2. User is redirected to TikTok OAuth using the Redirect URI.
  3. TikTok returns `code` and `state` to `https://messyandmagnetic.com/auth/tiktok/callback/`.
  4. Server exchanges the code for an access token.
  5. Token or video data is processed via `/api/tiktok/user` or `/api/tiktok/video`.
- **Last Updated:** 2025-08-16

