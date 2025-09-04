import React, { useEffect, useState } from 'react';
import DonorWall, { Donor } from '../components/DonorWall';
import Button from '../components/Button';
import { catalog } from '../../../src/commerce/products';

const donationProduct = catalog.find((p) => p.lookup_key === 'donation');

export default function DonorsPage() {
  const [donors, setDonors] = useState<Donor[]>([]);
  useEffect(() => {
    fetch('/donors/recent').then((r) => r.json()).then((d) => setDonors(d.results || d));
  }, []);
  return (
    <div className="p-4 space-y-4">
      <DonorWall donors={donors} />
      {donationProduct && (
        <Button href={`/intake?product=${donationProduct.lookup_key}`}>Give Support</Button>
      )}
    </div>
  );
}
