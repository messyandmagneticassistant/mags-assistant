import React, { useEffect } from "react";

export function FormEmbed({ formId, onSubmit }: { formId?: string; onSubmit?: () => void }) {
  useEffect(() => {
    function handler(e: MessageEvent) {
      const ev = (e.data || {}).event;
      if (e.origin === "https://tally.so" && (ev === "Tally.FormSubmitted" || ev === "onSubmit")) {
        onSubmit?.();
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSubmit]);

  if (!formId) return <p className="text-center">Form unavailable.</p>;
  const src = `https://tally.so/embed/${formId}?transparent=1`;
  return <iframe src={src} className="w-full h-screen" title="Tally Form" />;
}

export default FormEmbed;
