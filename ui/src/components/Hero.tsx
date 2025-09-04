import React from 'react';

export default function Hero({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="text-center py-20 bg-rose-100">
      <h1 className="font-serif text-4xl mb-4">{title}</h1>
      <div className="space-x-4">{children}</div>
    </section>
  );
}
