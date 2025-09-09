import React, { useEffect, useState } from 'react';
import FormEmbed from '../components/FormEmbed';

export default function IntakePage() {
  const [forms, setForms] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | undefined>();
  useEffect(() => {
    fetch('/admin/config')
      .then((r) => r.json())
      .then((cfg) => {
        const map: Record<string, string> = cfg['blueprint:tally'] || cfg.tally || {};
        setForms(map);
        const first = Object.values(map)[0];
        if (first) setSelected(first);
      })
      .catch(() => {});
  }, []);
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        {Object.entries(forms).map(([k, id]) => (
          <button
            key={k}
            onClick={() => setSelected(id)}
            className={`px-2 py-1 rounded border ${selected === id ? 'bg-indigo-500 text-white' : 'bg-white'}`}
          >
            {k}
          </button>
        ))}
      </div>
      <FormEmbed formId={selected} />
    </div>
  );
}
