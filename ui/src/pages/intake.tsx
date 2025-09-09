import React, { useEffect, useState } from 'react';
import FormEmbed from '../components/FormEmbed';

type FormMap = Record<string, string>;

export default function IntakePage() {
  const [forms, setForms] = useState<FormMap>({});
  const [formId, setFormId] = useState<string | undefined>();
  useEffect(() => {
    const product = new URLSearchParams(window.location.search).get('product');
    fetch('/admin/config')
      .then((r) => r.json())
      .then((cfg) => {
        const map: FormMap = cfg.tally || cfg['blueprint:tally'] || {};
        setForms(map);
        if (product && map[product]) setFormId(map[product]);
      })
      .catch(() => {});
  }, []);
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {Object.entries(forms).map(([label, id]) => (
          <button
            key={label}
            onClick={() => setFormId(id)}
            className={`px-2 py-1 border rounded ${formId === id ? 'bg-rose-200' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
      <FormEmbed formId={formId} />
    </div>
  );
}
