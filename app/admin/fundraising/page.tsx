'use client';
import React, { useState } from 'react';

export default function FundraisingAdminPage() {
  const [last, setLast] = useState<string>('never');

  async function call(path: string) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'x-api-key': 'demo', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const j = await res.json().catch(() => ({}));
    setLast(`${path} -> ${j.ok ? 'ok' : 'err'}`);
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="font-serif text-xl">Fundraising Admin</h1>
      <div className="space-x-2">
        <button className="border px-3 py-1" onClick={() => call('/fundraising/outreach')}>Send Outreach Now</button>
        <button className="border px-3 py-1" onClick={() => call('/fundraising/followup')}>Run Followups</button>
        <button className="border px-3 py-1" onClick={() => call('/fundraising/onepager')}>Rebuild One-Pager</button>
      </div>
      <p className="text-sm text-gray-600">Last: {last}</p>
    </div>
  );
}
