import React, { useEffect, useState } from 'react';
import DonorWall from '../components/DonorWall';
import Button from '../components/Button';

export default function DonorsPage() {
  const [url, setUrl] = useState<string>('#');
  useEffect(() => {
    fetch('/api/offerings').then((r) => r.json()).then((o) => {
      const first = o[0]?.prices?.[0]?.checkoutUrl;
      if (first) setUrl(first);
    }).catch(() => {});
  }, []);
  return (
    <div className="p-4 space-y-4">
      <DonorWall />
      <div className="text-center">
        <Button href={url}>Give Support</Button>
      </div>
    </div>
  );
}
