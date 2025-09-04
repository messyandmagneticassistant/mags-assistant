import React from 'react';
import Hero from '../components/Hero';
import Button from '../components/Button';

export default function IndexPage() {
  return (
    <div>
      <Hero title="Messy & Magnetic">
        <Button href="/offerings">Soul Blueprint</Button>
        <Button href="/offerings#scheduler">Scheduler</Button>
        <Button href="/donors">Donor portal</Button>
      </Hero>
    </div>
  );
}
