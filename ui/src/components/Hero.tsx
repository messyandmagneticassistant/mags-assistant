import React from 'react';

interface CTA { href: string; label: string; }

export default function Hero({ title, ctas }: { title: string; ctas: CTA[] }) {
  return (
    <section className="text-center py-10 bg-rose-100">
      <h1 className="text-3xl font-bold text-rose-800">{title}</h1>
      <div className="mt-4 flex flex-col gap-2 items-center">
        {ctas.map((c) => (
          <a key={c.href} href={c.href} className="bg-indigo-500 text-white px-4 py-2 rounded">
            {c.label}
          </a>
        ))}
      </div>
    </section>
  );
}
