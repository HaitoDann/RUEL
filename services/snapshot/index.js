/**
 * RUEL — Daily Snapshot Service
 * Runs via GitHub Actions every night at 23:45
 * Reads portfolio + latest prices from Gist
 * Calculates total patrimoine
 * Appends a snapshot entry to portfolio.snapshots[]
 */

const GIST_PAT          = process.env.GIST_PAT;
const PORTFOLIO_GIST_ID = process.env.PORTFOLIO_GIST_ID;
const PRICES_GIST_ID    = process.env.PRICES_GIST_ID;

const GIST_HEADERS = {
  Authorization: `Bearer ${GIST_PAT}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

async function readGist(gistId) {
  const r = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: GIST_HEADERS,
  });
  if (!r.ok) throw new Error(`Gist read failed: ${r.status}`);
  const data = await r.json();
  const file = Object.values(data.files)[0];
  return JSON.parse(file.content || '{}');
}

async function writeGist(gistId, filename, content) {
  const r = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: GIST_HEADERS,
    body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(content, null, 2) } } }),
  });
  if (!r.ok) throw new Error(`Gist write failed: ${r.status}`);
}

// ── Compute total patrimoine ──────────────────────────────
function computePatrimoine(portfolio, prices) {
  const stocks = prices.stocks || {};
  const crypto = prices.crypto || {};

  // Apply latest prices to portfolio
  const pea   = (portfolio.pea  || []).map((s) => ({ ...s, cours: stocks[s.symbol] ?? s.cours }));
  const cto   = (portfolio.cto  || []).map((s) => ({ ...s, cours: stocks[s.symbol] ?? s.cours }));
  const crp   = (portfolio.crypto || []).map((c) => ({
    ...c,
    prixUnit: crypto[c.geckoId]?.eur ?? c.prixUnit,
  }));

  const peaVal  = pea.reduce((a, s) => a + s.cours * s.qte, 0);
  const ctoVal  = cto.reduce((a, s) => a + s.cours * s.qte, 0);
  const crpVal  = crp.reduce((a, c) => a + c.prixUnit * c.qte, 0);
  const epVal   = (portfolio.epargne || []).reduce((a, e) => a + e.montant, 0);
  const courant = portfolio.meta?.courant || 0;

  return Math.round(peaVal + ctoVal + crpVal + epVal + courant);
}

// ── Format date as DD/MM ──────────────────────────────────
function todayLabel() {
  const now = new Date();
  const d   = String(now.getDate()).padStart(2, '0');
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

// ── Main ─────────────────────────────────────────────────
async function main() {
  console.log(`\n📸 Snapshot Service started — ${new Date().toISOString()}`);

  // 1. Read portfolio & prices
  const [portfolio, prices] = await Promise.all([
    readGist(PORTFOLIO_GIST_ID),
    readGist(PRICES_GIST_ID),
  ]);

  // 2. Compute total
  const total = computePatrimoine(portfolio, prices);
  const label = todayLabel();

  console.log(`📊 Patrimoine calculé : ${total.toLocaleString('fr-FR')} € (${label})`);

  // 3. Append snapshot (avoid duplicates for same day)
  const snapshots = portfolio.snapshots || [];
  const existing  = snapshots.findIndex((s) => s.date === label);

  if (existing >= 0) {
    snapshots[existing].val = total;
    console.log('♻️  Snapshot du jour mis à jour');
  } else {
    snapshots.push({ date: label, val: total });
    console.log('✅ Nouveau snapshot ajouté');
  }

  // Keep only last 90 days
  if (snapshots.length > 90) snapshots.splice(0, snapshots.length - 90);

  portfolio.snapshots = snapshots;

  // 4. Save updated portfolio
  await writeGist(PORTFOLIO_GIST_ID, 'portfolio.json', portfolio);

  console.log(`\n✨ Snapshot sauvegardé : ${label} → ${total.toLocaleString('fr-FR')} €`);
}

main().catch((err) => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});