'use client';
import React, { useState } from 'react';

export default function StripeAdminPage() {
  const [plan, setPlan] = useState<any>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  async function loadPlan() {
    const res = await fetch('/api/stripe/sync/plan');
    const j = await res.json();
    setPlan(j);
    const sel: Record<string, boolean> = {};
    (j.items || []).forEach((it: any) => (sel[it.name] = true));
    setSelected(sel);
  }

  async function runFix() {
    const names = Object.keys(selected).filter((n) => selected[n]);
    const res = await fetch('/api/stripe/sync/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    });
    const j = await res.json();
    alert(j.ok ? 'Sync complete' : j.error);
  }

  return (
    <div className="p-4">
      <h1 className="font-serif text-2xl mb-4">Stripe Sync</h1>
      <div className="space-x-2 mb-4">
        <button className="border px-3 py-1" onClick={loadPlan}>
          Plan
        </button>
        <button className="border px-3 py-1" onClick={runFix}>
          Fix All Now
        </button>
      </div>
      {plan && (
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th></th>
              <th>Product</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.map((it: any) => (
              <tr key={it.name} className="border-t">
                <td>
                  <input
                    type="checkbox"
                    checked={!!selected[it.name]}
                    onChange={(e) =>
                      setSelected({ ...selected, [it.name]: e.target.checked })
                    }
                  />
                </td>
                <td>{it.name}</td>
                <td>{it.actions.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
