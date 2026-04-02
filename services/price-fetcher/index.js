/**
 * RUEL — Price Fetcher Service
 * Runs via GitHub Actions every 15 minutes (weekdays)
 * Reads portfolio symbols from portfolio Gist
 * Fetches prices from Finnhub (stocks) + CoinGecko (crypto)
 * Writes updated prices to the public prices Gist
 */

const FINNHUB_KEY       = process.env.FINNHUB_KEY;
const GIST_PAT          = process.env.GIST_PAT;
const PORTFOLIO_GIST_ID = process.env.PORTFOLIO_GIST_ID;
const PRICES_GIST_ID    = process.env.PRICES_GIST_ID;

const GIST_HEADERS = {
  Authorization: `Bearer ${GIST_PAT}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

// ── Helpers ──────────────────────────────────────────────
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readGist(gistId) {
  const r = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: GIST_HEADERS,
  });
  if (!r.ok) throw new Error(`Gist read failed: ${r.status} ${await r.text()}`);
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
  if (!r.ok) throw new Error(`Gist write failed: ${r.status} ${await r.text()}`);
}

// ── Fetch crypto prices (CoinGecko — free, no key) ───────
async function fetchCryptoPrices(geckoIds) {
  if (!geckoIds.length) return {};
  const ids = geckoIds.join(',');
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`
  );
  if (!r.ok) {
    console.warn('CoinGecko error:', r.status);
    return {};
  }
  return r.json();
}

// ── Fetch one stock price (Finnhub) ──────────────────────
async function fetchStockPrice(symbol) {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`
  );
  if (!r.ok) return null;
  const d = await r.json();
  return d.c > 0 ? d.c : null;
}

// ── Main ─────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Price Fetcher started — ${new Date().toISOString()}`);

  // 1. Load portfolio to get symbols
  console.log('📂 Loading portfolio from Gist…');
  const portfolio = await readGist(PORTFOLIO_GIST_ID);

  const stockSymbols = [
    ...(portfolio.pea  || []).map((s) => s.symbol).filter(Boolean),
    ...(portfolio.cto  || []).map((s) => s.symbol).filter(Boolean),
  ];
  const geckoIds = (portfolio.crypto || []).map((c) => c.geckoId).filter(Boolean);

  console.log(`📈 Stocks to fetch: ${stockSymbols.join(', ') || 'none'}`);
  console.log(`₿  Crypto to fetch: ${geckoIds.join(', ')     || 'none'}`);

  // 2. Fetch crypto (single batched call)
  console.log('\n🔄 Fetching crypto prices from CoinGecko…');
  const cryptoPrices = await fetchCryptoPrices(geckoIds);
  console.log('✅ Crypto:', JSON.stringify(cryptoPrices));

  // 3. Fetch stock prices one by one (Finnhub rate limit: 60 req/min)
  const stockPrices = {};
  for (const symbol of stockSymbols) {
    const price = await fetchStockPrice(symbol);
    if (price !== null) {
      stockPrices[symbol] = price;
      console.log(`✅ ${symbol}: ${price} €`);
    } else {
      console.warn(`⚠️  ${symbol}: no price returned`);
    }
    await sleep(350); // ~170 req/min max → safe for 60 req/min limit
  }

  // 4. Write prices to public prices Gist
  const payload = {
    stocks: stockPrices,
    crypto: cryptoPrices,
    updatedAt: new Date().toISOString(),
    symbols: stockSymbols,
    geckoIds,
  };

  console.log('\n💾 Writing prices to Gist…');
  await writeGist(PRICES_GIST_ID, 'prices.json', payload);

  console.log(`\n✨ Done — ${Object.keys(stockPrices).length} stocks + ${geckoIds.length} cryptos updated.`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});