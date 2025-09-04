import React from 'react';

export default function Card({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-4 shadow bg-white">
      <h2 className="font-serif text-xl mb-2">{title}</h2>
      <div>{children}</div>
    </div>
  );
}
