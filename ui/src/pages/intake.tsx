import React, { useEffect, useState } from 'react';
import FormEmbed from '../components/FormEmbed';

export default function IntakePage() {
  const [formId, setFormId] = useState<string | undefined>();
  useEffect(() => {
    const product = new URLSearchParams(window.location.search).get('product');
    fetch('/admin/config').then((r) => r.json()).then((cfg) => {
      const map = cfg.tally || cfg['blueprint:tally'] || {};
      if (product && map[product]) setFormId(map[product]);
    }).catch(() => {});
  }, []);
  return (
    <div className="p-4">
      <FormEmbed formId={formId} />
    </div>
  );
}
