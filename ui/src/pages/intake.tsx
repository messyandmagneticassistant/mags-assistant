import { useEffect, useState } from "react";
import { FormEmbed } from "../components/FormEmbed";

type FormMap = Record<string, string>; // label -> formId

export default function IntakePage() {
  const [forms, setForms] = useState<FormMap>({});
  const [formId, setFormId] = useState<string | null>(null);

  useEffect(() => {
    const product = new URLSearchParams(window.location.search).get("product") ?? "";

    fetch("/admin/config")
      .then((r) => r.json())
      .then((cfg) => {
        const map: FormMap = cfg?.forms || {};
        setForms(map);

        // If product provided and exists in map, select it; otherwise pick first entry
        const keys = Object.keys(map);
        if (product && map[product]) setFormId(map[product]);
        else if (keys.length) setFormId(map[keys[0]]);
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
            className="px-2 py-1 border rounded"
          >
            {label}
          </button>
        ))}
      </div>

      {formId ? <FormEmbed formId={formId} /> : <p>Loading…</p>}
    </div>
  );
}

