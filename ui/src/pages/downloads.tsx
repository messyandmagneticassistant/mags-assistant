import React, { useEffect, useState } from 'react';

interface Link { name?: string; url: string; }

export default function DownloadsPage() {
  const [links, setLinks] = useState<Link[]>([]);
  useEffect(() => {
    fetch('/orders/links').then((r) => r.json()).then(setLinks).catch(() => {});
  }, []);
  return (
    <div className="p-4 space-y-2">
      {links.length > 0 ? (
        links.map((l, i) => (
          <a key={i} href={l.url} className="underline text-indigo-600">
            {l.name || l.url}
          </a>
        ))
      ) : (
        <p>Downloads will appear here after purchase.</p>
      )}
    </div>
  );
}
