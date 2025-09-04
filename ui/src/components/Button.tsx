import React from 'react';

export default function Button({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="bg-emerald-500 text-white px-4 py-2 rounded inline-block">
      {children}
    </a>
  );
}
