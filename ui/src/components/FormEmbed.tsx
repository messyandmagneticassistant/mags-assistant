import React from 'react';

export default function FormEmbed({ formId }: { formId?: string }) {
  if (!formId) return <p className="text-center">Form unavailable.</p>;
  const src = `https://tally.so/embed/${formId}?transparent=1`;
  return <iframe src={src} className="w-full h-screen" title="Tally Form" />;
}
