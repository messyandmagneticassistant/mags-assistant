'use client';

import { useEffect, useState } from 'react';
import ChatUI from '../../components/ChatUI';
import ClipUploader from '../../components/ClipUploader';
import { COOKIE_NAME, verifyPassword, sessionCookie } from '../../lib/auth';

export default function ChatPage() {
  const [authed, setAuthed] = useState(false);
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (!process.env.CHAT_PASSWORD) {
      setAuthed(true);
      setWarning(true);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');
    if (key && verifyPassword(key)) {
      document.cookie = sessionCookie(key);
      setAuthed(true);
      return;
    }
    if (document.cookie.includes(`${COOKIE_NAME}=`)) {
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    const clear = () => {
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'clear', title: 'chat open' }),
      });
    };

    clear();
    window.addEventListener('focus', clear);
    return () => window.removeEventListener('focus', clear);
  }, []);

  if (!authed) return <div>Enter chat password.</div>;

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-6">
      <section>
        <h1 className="text-2xl mb-2">Upload a clip</h1>
        <ClipUploader />
      </section>
      <section>
        <h2 className="text-xl mb-2">Chat</h2>
        <ChatUI />
      </section>
      {warning && (
        <p className="text-xs opacity-70">Password disabled; dev mode.</p>
      )}
    </main>
  );
}

