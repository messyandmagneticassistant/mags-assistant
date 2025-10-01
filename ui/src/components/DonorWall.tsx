import React, { useEffect, useState } from 'react';

interface Donation { name: string; amount: number; intent: string; createdAt: string; }

export default function DonorWall() {
  const [list, setList] = useState<Donation[]>([]);
  useEffect(() => {
    fetch('/donors/recent')
      .then((r) => r.json())
      .then((res) => {
        if (Array.isArray(res.donors)) {
          setList(res.donors);
        } else {
          console.warn('Invalid donor list:', res);
        }
      })
      .catch(() => {});
  }, []);
  return (
    <div className="space-y-2">
      {list.map((d, i) => (
        <div key={i} className="p-2 bg-indigo-50 rounded">
          <p className="font-semibold text-indigo-700">{d.name}</p>
          <p className="text-sm">${d.amount} — {d.intent}</p>
        </div>
      ))}
      {list.length === 0 && <p>No donors yet.</p>}
    </div>
  );
}
