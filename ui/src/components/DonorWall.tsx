import React from 'react';

export interface Donor { name: string; amount: number; intent?: string }

export default function DonorWall({ donors }: { donors: Donor[] }) {
  return (
    <ul className="space-y-2">
      {donors.map((d, i) => (
        <li key={i} className="bg-emerald-100 p-2 rounded">
          <span className="font-serif">{d.name}</span> – ${'{'}d.amount / 100{'}'}
        </li>
      ))}
    </ul>
  );
}
