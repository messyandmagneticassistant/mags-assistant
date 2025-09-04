import React, { useEffect, useState } from 'react';
import Card from '../components/Card';
import Button from '../components/Button';

interface Offering {
  id: string;
  name: string;
  lookup_key: string;
  prices: { id: string; unit_amount: number; currency: string; checkoutUrl?: string }[];
}

export default function OfferingsPage() {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  useEffect(() => {
    fetch('/api/offerings').then((r) => r.json()).then(setOfferings).catch(() => {});
  }, []);
  return (
    <div className="p-4 space-y-4">
      {offerings.map((o) => (
        <Card key={o.id} title={o.name}>
          {o.prices.map((p) => (
            <div key={p.id} className="flex justify-between items-center mb-2">
              <span>
                {p.currency.toUpperCase()} {p.unit_amount / 100}
              </span>
              {p.checkoutUrl && <Button href={p.checkoutUrl}>Buy</Button>}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
