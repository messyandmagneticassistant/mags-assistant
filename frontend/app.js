// /frontend/app.js
const WEBAPP_URL = 'https://maggie.messyandmagnetic.com/api/appscript';

async function fetchFarmstand() {
  const res = await fetch(`${WEBAPP_URL}?cmd=farmstand-feed`, { cache: "no-store" });
  const data = await res.json().catch(() => ({ items: [] }));
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  if (!data.items || data.items.length === 0) {
    grid.innerHTML = `<div class="empty">No active items right now. Check back soon 🌿</div>`;
    return;
  }
  for (const item of data.items) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img src="${item.image || 'https://picsum.photos/seed/' + encodeURIComponent(item.name) + '/640/420'}" alt="">
      <div class="card-body">
        <h3>${item.name}</h3>
        <p>${item.desc || ''}</p>
        <div class="meta">
          <span class="price">$${(item.price_cents/100).toFixed(2)}</span>
          <button data-id="${item.id}" class="buy">Buy</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.buy');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Redirecting…';
    try {
      const r = await fetch(`${WEBAPP_URL}?cmd=farmstand-checkout&id=${encodeURIComponent(btn.dataset.id)}`);
      const j = await r.json();
      if (j && j.url) window.location.href = j.url;
      else alert('Checkout unavailable.');
    } catch {
      alert('Checkout error.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buy';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('grid')) fetchFarmstand();
});