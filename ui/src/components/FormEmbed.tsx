import React from 'react';

export default function FormEmbed({ formId }: { formId: string }) {
  return (
    <iframe
      src={`https://tally.so/embed/${formId}`}
      width="100%"
      height="600"
      className="w-full"
      frameBorder="0"
    ></iframe>
  );
}
