import React, { useEffect, useState } from 'react';

export default function DownloadsPage() {
  const [links, setLinks] = useState<string[]>([]);
  useEffect(() => {
    fetch('/orders/links').then((r) => r.json()).then((d) => setLinks(d.links || []));
  }, []);
  return (
    <div className="p-4 space-y-2">
      {links.map((l, i) => (
        <a key={i} className="text-indigo-600 underline" href={l}>
          Download {i + 1}
        </a>
      ))}
    </div>
  );
}
