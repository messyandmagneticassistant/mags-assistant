'use client';
import { useState } from 'react';

export default function SyncStripeButton({ rowId, label = 'Sync Stripe ↔ Notion' }: { rowId?: string; label?: string }) {
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    setMsg('');
    try {
      const url = rowId
        ? `/api/stripe/sync?mode=fix&row=${rowId}`
        : '/api/stripe/sync?mode=full&dry=0';
      const res = await fetch(url);
      const json = await res.json();
      setMsg(json.ok ? 'done' : json.error || 'error');
    } catch (e: any) {
      setMsg('error');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div>
      <button
        onClick={run}
        disabled={loading}
        className="px-3 py-1 rounded border"
      >
        {loading ? 'Running…' : label}
      </button>
      {msg && <p className="text-xs mt-1 opacity-70">{msg}</p>}
    </div>
  );
}
