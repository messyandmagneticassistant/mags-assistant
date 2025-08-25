'use client';
import { useState, useEffect } from 'react';

export default function DriveOpsPage() {
  const [status, setStatus] = useState<any>(null);

  async function load() {
    const r = await fetch('/api/drive/watch');
    const j = await r.json();
    setStatus(j.watchers || {});
  }

  async function start() {
    await fetch('/api/drive/watch', { method: 'POST' });
    await load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 space-y-4">
      <h1 className="font-serif text-2xl">Drive Watch</h1>
      <button className="border px-4 py-2" onClick={start}>Start watch</button>
      <pre className="bg-gray-100 p-2 text-xs">{JSON.stringify(status, null, 2)}</pre>
    </div>
  );
}
