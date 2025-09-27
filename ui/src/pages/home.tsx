import React, { useEffect } from 'react';
import './home.css';

export default function HomePage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Messy & Magnetic™ | Soul-Led Systems for Rare Spirits';
    document.body.classList.add('mm-body');

    return () => {
      document.title = previousTitle || 'Messy & Magnetic™';
      document.body.classList.remove('mm-body');
    };
  }, []);

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div className="mm-brand">Messy &amp; Magnetic™</div>
        <nav className="mm-nav" aria-label="Primary navigation">
          <ul>
            <li>
              <a href="#soul-blueprint">Soul Readings</a>
            </li>
            <li>
              <a href="#magnet-kits">Magnet Kits</a>
            </li>
            <li>
              <a href="#poleo-creek">Donate</a>
            </li>
            <li>
              <a href="#faq">FAQ</a>
            </li>
          </ul>
        </nav>
      </header>

      <main className="mm-main">
        <section className="mm-hero" id="top">
          <div className="mm-hero__inner">
            <p className="mm-hero__eyebrow">Welcome, luminous soul</p>
            <h1>Your Soul is Rare — Let It Be Seen.</h1>
            <p className="mm-hero__copy">
              Systems and rituals that harmonize your intuition, family, and daily flow so your rarest self can lead.
            </p>
            <a className="mm-button mm-button--primary" href="https://tally.so/r/w268rj" target="_blank" rel="noreferrer">
              Start My Soul Blueprint
            </a>
          </div>
        </section>

        <section className="mm-section" id="soul-blueprint">
          <div className="mm-section-heading">
            <h2>Soul Blueprint Readings</h2>
            <p>Mini, Lite, and Full readings that are personalized, magical, and automated for your next quantum leap.</p>
          </div>
          <div className="mm-card-grid">
            <article className="mm-card">
              <h3>Mini Blueprint</h3>
              <p>Quick clarity for emergent moments. A concise energetic snapshot to guide your immediate moves.</p>
            </article>
            <article className="mm-card">
              <h3>Lite Blueprint</h3>
              <p>Deep-dive audio and ritual map to align your week with easeful magnetism.</p>
            </article>
            <article className="mm-card">
              <h3>Full Blueprint</h3>
              <p>Full-system reading with automations, rituals, and reminders designed to support your soul-led life.</p>
            </article>
          </div>
        </section>

        <section className="mm-section mm-section--alt" id="magnet-kits">
          <div className="mm-section-heading">
            <h2>Magnet Rhythm Kits</h2>
            <p>Daily and weekly schedule systems that sync your energy with what matters most.</p>
          </div>
          <div className="mm-card-grid">
            <article className="mm-card">
              <h3>Daily Orbit</h3>
              <p>Morning and evening rituals with gentle prompts, reminders, and a sanctuary for your intentions.</p>
            </article>
            <article className="mm-card">
              <h3>Weekly Pulse</h3>
              <p>Strategic alignment across the week with energy-aware planning templates and automation cues.</p>
            </article>
            <article className="mm-card">
              <h3>Seasonal Sync</h3>
              <p>Quarterly recalibration sessions to refresh your goals and anchor your magnetism.</p>
            </article>
          </div>
        </section>

        <section className="mm-section" id="family-bundles">
          <div className="mm-section-heading">
            <h2>Family Bundles</h2>
            <p>Child, partner, and elder add-ons that weave your loved ones into the rhythm of your soul-led home.</p>
          </div>
          <div className="mm-card-grid">
            <article className="mm-card">
              <h3>Child Star</h3>
              <p>Developmentally attuned rituals and reflections to ground the littlest luminaries.</p>
            </article>
            <article className="mm-card">
              <h3>Partner Flow</h3>
              <p>Communication cadences and co-created rituals that cultivate intimacy and shared magnetism.</p>
            </article>
            <article className="mm-card">
              <h3>Elder Echoes</h3>
              <p>Legacy honoring practices and soft structure for aging loved ones who keep your lineage bright.</p>
            </article>
          </div>
        </section>

        <section className="mm-section mm-section--alt" id="poleo-creek">
          <div className="mm-section-heading">
            <h2>Poleo Creek Retreat</h2>
            <p>A sanctuary in the making. Support the land that holds our future retreats and gatherings.</p>
            <span className="mm-button--ghost" aria-disabled="true">
              Donate (coming soon)
            </span>
          </div>
        </section>

        <section className="mm-faq" id="faq">
          <div className="mm-section-heading">
            <h2>FAQ</h2>
          </div>
          <div className="mm-faq-grid">
            <article>
              <h3>How do I begin?</h3>
              <p>Click “Start My Soul Blueprint” above to request your reading and receive next steps in your inbox.</p>
            </article>
            <article>
              <h3>When will kits and bundles ship?</h3>
              <p>We’re finalizing automations now. Join the blueprint waitlist and you’ll get first access when they launch.</p>
            </article>
            <article>
              <h3>Can I book a live session?</h3>
              <p>Live experiences are offered seasonally. Reply to any email from Maggie to request a bespoke option.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="mm-footer">
        <div className="mm-footer__contact">
          <a href="mailto:maggie@messyandmagnetic.com">maggie@messyandmagnetic.com</a>
          <span className="mm-dot" aria-hidden="true">
            •
          </span>
          <a href="https://www.tiktok.com/@messyandmagnetic" target="_blank" rel="noreferrer">
            TikTok @messyandmagnetic
          </a>
        </div>
        <p className="mm-footer__note">Made with love + stardust by Maggie</p>
      </footer>
    </div>
  );
}
