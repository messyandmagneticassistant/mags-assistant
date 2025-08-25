export function gmailEnabled() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

export async function watchForEmail() {
  if (!gmailEnabled()) {
    return { ok: false, message: 'email disabled' };
  }
  // Stub implementation; real Gmail polling would go here.
  return { ok: true, checked: 0 };
}

export async function sendApprovedDrafts() {
  if (!gmailEnabled()) {
    return { ok: false, message: 'email disabled' };
  }
  // Stub implementation; real Gmail send logic would go here.
  return { ok: true, sent: 0 };
}
