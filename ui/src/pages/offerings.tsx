import React from 'react';
import Card from '../components/Card';
import Button from '../components/Button';
import { catalog } from '../../../src/commerce/products';

export default function OfferingsPage() {
  return (
    <div className="p-4 grid gap-4 md:grid-cols-2">
      {catalog.map((p) => (
        <Card key={p.id} title={p.name}>
          <p className="mb-2">${'{'}(p.amount / 100).toFixed(2){'}'}</p>
          <Button href={`/intake?product=${p.lookup_key}`}>Start</Button>
        </Card>
      ))}
    </div>
  );
}
