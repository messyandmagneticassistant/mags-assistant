import React from 'react';
import Hero from '../components/Hero';

export default function HomePage() {
  return (
    <Hero
      title="Messy & Magnetic"
      ctas={[
        { href: '/offerings#blueprint', label: 'Soul Blueprint' },
        { href: '/offerings#scheduler', label: 'Scheduler' },
        { href: '/donors', label: 'Donor portal' },
      ]}
    />
  );
}
