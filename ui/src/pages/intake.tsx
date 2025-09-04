import React from 'react';
import FormEmbed from '../components/FormEmbed';

const FORMS: Record<string, string> = {
  soul_blueprint: 'FORM_ID_BLUEPRINT',
  donation: 'FORM_ID_DONATION',
};

export default function IntakePage() {
  const params = new URLSearchParams(window.location.search);
  const product = params.get('product') || 'soul_blueprint';
  const formId = FORMS[product] || FORMS.soul_blueprint;
  return (
    <div className="p-4">
      <FormEmbed formId={formId} />
    </div>
  );
}
