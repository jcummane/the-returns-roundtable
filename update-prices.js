/**
 * update-prices.js
 * 
 * Fetches current prices for all tickers in the competition,
 * calculates portfolio returns, and writes everything to Firebase.
 * 
 * Runs server-side via GitHub Actions — no CORS issues.
 * 
 * Required env var:
 *   FIREBASE_DB_URL — e.g. https://stock-picking-challenge-3882f-default-rtdb.firebaseio.com
 */

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
if (!FIREBASE_DB_URL) {
  console.error('Missing FIREBASE_DB_URL environment variable');
  process.exit(1);
}

const START = '2026-03-01';
const END = '2027-02-28';

// ─── Firebase helpers ───

const encKey = k => k.replace(/\./g, '_DOT_');
const decKey = k => k.replace(/_DOT_/g, '.');

function encObj(o) {
  if (!o) return null;
  const r = {};
  for (const [k, v] of Object.entries(o)) r[encKey(k)] = v;
  return r;
}

function decObj(o) {
  if (!o) return null;
  const r = {};
  for (const [k, v] of Object.entries(o)) r[decKey(k)] = v;
  return r;
}

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET ${path} failed: ${res.status}`);
  return res.json();
}

async function fbSet(path, data) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT ${path} failed: ${res.status}`);
  return res.json();
}

async function fbPush(path, data) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase POST ${path} failed: ${res.status}`);
  return res.json();
}

// ─── Yahoo Finance ───

async function fetchPrice(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)' },
    });
    if (!res.ok) {
      console.warn(`  ✗ ${ticker}: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.warn(`  ✗ ${ticker}: no chart data`);
      return null;
    }

    const closes = result.indicators.quote[0].close.filter(Boolean);
    const timestamps = result.timestamp;

    // Find the price on or after competition start
    const startTs = new Date(START).getTime() / 1000;
    let startIdx = timestamps.findIndex(t => t >= startTs);
    if (startIdx < 0) startIdx = 0;

    const startPrice = closes[startIdx] || closes[0];
    const currentPrice = closes[closes.length - 1];

    if (startPrice && currentPrice) {
      return { sp: startPrice, cp: currentPrice, u: new Date().toISOString() };
    }
    console.warn(`  ✗ ${ticker}: missing price data`);
    return null;
  } catch (err) {
    console.warn(`  ✗ ${ticker}: ${err.message}`);
    return null;
  }
}

// ─── Portfolio return calculation ───

function calcReturn(portfolio, prices) {
  let sum = 0, count = 0;
  const entryPrices = portfolio.entryPrices ? decObj(portfolio.entryPrices) : {};

  for (const ticker of portfolio.tickers) {
    const p = prices[ticker];
    if (!p?.sp || !p?.cp) continue;

    // Use portfolio-specific entry price for swapped stocks
    const base = entryPrices[ticker] || p.sp;
    sum += ((p.cp - base) / base) * 0.2;
    count++;
  }
  return count > 0 ? sum : null;
}

// ─── Main ───

async function main() {
  const now = new Date();
  console.log(`\n🕐 ${now.toISOString()}`);
  console.log(`📊 Returns Roundtable — Price Update\n`);

  // Check competition is active
  if (now < new Date(START)) {
    console.log('⏳ Competition hasn\'t started yet. Exiting.');
    return;
  }
  if (now > new Date(END)) {
    console.log('🏁 Competition is complete. Exiting.');
    return;
  }

  // 1. Load portfolios
  console.log('📂 Loading portfolios from Firebase...');
  const portfoliosRaw = await fbGet('portfolios');
  if (!portfoliosRaw) {
    console.log('  No portfolios found. Exiting.');
    return;
  }

  const portfolios = Object.entries(portfoliosRaw).map(([id, data]) => ({
    id,
    ...data,
  }));
  console.log(`  Found ${portfolios.length} portfolios`);

  // 2. Collect unique tickers
  const allTickers = [...new Set(portfolios.flatMap(p => p.tickers))];
  console.log(`  ${allTickers.length} unique tickers to fetch\n`);

  // 3. Load existing prices
  const existingPricesRaw = await fbGet('prices');
  const prices = decObj(existingPricesRaw) || {};

  // 4. Fetch prices from Yahoo Finance
  console.log('📈 Fetching prices from Yahoo Finance...');
  let successCount = 0;

  for (const ticker of allTickers) {
    const result = await fetchPrice(ticker);
    if (result) {
      prices[ticker] = result;
      const ret = ((result.cp - result.sp) / result.sp * 100).toFixed(2);
      console.log(`  ✓ ${ticker}: $${result.sp.toFixed(2)} → $${result.cp.toFixed(2)} (${ret >= 0 ? '+' : ''}${ret}%)`);
      successCount++;
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n  ${successCount}/${allTickers.length} tickers updated`);

  // 5. Write prices to Firebase
  console.log('\n💾 Saving prices to Firebase...');
  await fbSet('prices', encObj(prices));
  console.log('  ✓ Prices saved');

  // 6. Calculate portfolio returns and save history snapshot
  console.log('\n📊 Calculating portfolio returns...');
  const snapshot = {
    d: now.toISOString(),
    r: {},
  };

  for (const p of portfolios) {
    const ret = calcReturn(p, prices);
    if (ret != null) {
      snapshot.r[p.id] = ret;
      const pct = (ret * 100).toFixed(2);
      console.log(`  ${p.advisorName}: ${ret >= 0 ? '+' : ''}${pct}%`);
    } else {
      console.log(`  ${p.advisorName}: pending (missing price data)`);
    }
  }

  if (Object.keys(snapshot.r).length > 0) {
    await fbPush('history', snapshot);
    console.log('  ✓ History snapshot saved');
  }

  console.log('\n✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
