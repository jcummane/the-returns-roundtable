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

  // Check competition status
  const preComp = now < new Date(START);
  const postComp = now > new Date(END);

  if (postComp) {
    console.log('🏁 Competition is complete. Exiting.');
    return;
  }
  if (preComp) {
    console.log('⏳ Competition hasn\'t started yet — fetching prices for preview only.\n');
  }

  // 1. Full ticker universe — fetch prices for all, not just registered portfolios
  const UNIVERSE = [
    // ASX SHARES
    "BHP.AX","CBA.AX","CSL.AX","WBC.AX","NAB.AX","ANZ.AX","WES.AX","MQG.AX","FMG.AX","TLS.AX",
    "RIO.AX","WDS.AX","ALL.AX","GMG.AX","TCL.AX","COL.AX","WOW.AX","REA.AX","JHX.AX","STO.AX",
    "XRO.AX","SHL.AX","QBE.AX","ORG.AX","MIN.AX","CPU.AX","SUN.AX","IAG.AX","APA.AX","CAR.AX",
    "SEK.AX","TWE.AX","PME.AX","WTC.AX","TNE.AX","LYC.AX","RMD.AX","ALD.AX","EVN.AX","NST.AX",
    "MPL.AX","ORI.AX","AMC.AX","BSL.AX","DXS.AX","GPT.AX","MGR.AX","SGP.AX","VCX.AX","SCG.AX",
    "CHC.AX","LLC.AX","IEL.AX","NHF.AX","QAN.AX","SVW.AX","NWS.AX","TAH.AX","PLS.AX","IGO.AX",
    "AZJ.AX","SOL.AX","ALX.AX","FPH.AX","CWY.AX","ILU.AX","ZIP.AX","HUB.AX","NWL.AX","PDN.AX",
    "WHC.AX","S32.AX","BRN.AX","WBT.AX","SFR.AX","DRR.AX","AGL.AX","TPG.AX","CEN.AX","JBH.AX",
    // ASX ETFs — BetaShares
    "A200.AX","AAA.AX","NDQ.AX","HNDQ.AX","DHHF.AX","DZZF.AX","DGGF.AX","DBBF.AX","BGBL.AX",
    "ATEC.AX","HACK.AX","RBTZ.AX","CLDD.AX","SEMI.AX","GAME.AX","DRIV.AX","IPAY.AX","IBUY.AX",
    "ASIA.AX","CRYP.AX","ETHI.AX","HETH.AX","FAIR.AX","ERTH.AX","QLTY.AX","HQLT.AX","INCM.AX",
    "IIND.AX","QUS.AX","F100.AX","QOZ.AX","EX20.AX","QFN.AX","QRE.AX","OZBD.AX","CRED.AX",
    "AGVT.AX","GGOV.AX","GBND.AX","QPON.AX","HBRD.AX","BHYB.AX","GEAR.AX","GGUS.AX","BEAR.AX",
    "BBOZ.AX","BBUS.AX","QAU.AX","OOO.AX","USD.AX","EEU.AX","POU.AX","FOOD.AX","BNKS.AX",
    "FUEL.AX","MNRS.AX","DRUG.AX","SMLL.AX","HVST.AX","YMAX.AX","UMAX.AX","HEUR.AX","HJPN.AX",
    "WRLD.AX","AUST.AX","EMMG.AX","EINC.AX",
    // ASX ETFs — Franklin Templeton
    "BNDS.AX","CIIH.AX","CUIV.AX","CIVH.AX","R3AL.AX","FRAR.AX","FRGG.AX",
    // ASX ETFs — Vanguard
    "VAS.AX","VGS.AX","VGAD.AX","VTS.AX","VEU.AX","VHY.AX","VLC.AX","VSO.AX","VGE.AX","VAP.AX",
    "VAF.AX","VGB.AX","VACF.AX","VEQ.AX","VAE.AX","VDHG.AX","VDGR.AX","VDBA.AX","VDCO.AX",
    "VETH.AX","VISM.AX",
    // ASX ETFs — iShares
    "IOZ.AX","IVV.AX","IHVV.AX","IEM.AX","IVE.AX","IJP.AX","IEU.AX","IOO.AX","IHOO.AX","IAA.AX",
    "IZZ.AX","IRU.AX","IJH.AX","IJR.AX","ILC.AX","ISO.AX","IHD.AX","IXJ.AX","IXI.AX","IAF.AX",
    "IGB.AX","ILB.AX","IHWL.AX","IWLD.AX","IESG.AX","IHCB.AX","IHHY.AX","IHEB.AX","WDMF.AX",
    "MVOL.AX","IKO.AX","ITW.AX",
    // ASX ETFs — VanEck
    "QUAL.AX","QHAL.AX","QSML.AX","MOAT.AX","GOAT.AX","MVW.AX","MVB.AX","MVR.AX","MVA.AX",
    "MVE.AX","MVS.AX","DVDY.AX","SUBD.AX","PLUS.AX","FLOT.AX","IFRA.AX","REIT.AX","GDX.AX",
    "CLNE.AX","HLTH.AX","ESGI.AX","GRNV.AX","VLUE.AX","EMKT.AX","CETF.AX","CNEW.AX","ESPO.AX",
    "GCAP.AX","EBND.AX",
    // ASX ETFs — SPDR
    "STW.AX","SFY.AX","SPY.AX","SSO.AX","WXOZ.AX","WXHG.AX","WEMG.AX","WDIV.AX","BOND.AX",
    "GOVT.AX","OZF.AX","SLF.AX","OZR.AX","SYI.AX","DJRE.AX",
    // ASX ETFs — Russell & Other
    "RDV.AX","RVL.AX","RARI.AX","RCB.AX","RSM.AX","RGB.AX","PMGOLD.AX","ESTX.AX","ROBO.AX",
    "TECH.AX","ZGOL.AX","ZOZI.AX","ZYAU.AX","ZYUS.AX","MOGL.AX",
    // NASDAQ
    "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","NFLX","AMD","AVGO","COST","ADBE","CRM",
    "QCOM","INTC","PEP","SBUX","PYPL","ABNB","COIN","UBER","SQ","SNOW","PANW","CRWD","ARM",
    "MRVL","PLTR","SMCI","MU","LRCX","KLAC","AMAT","SNPS","CDNS","MELI","BKNG","ISRG","REGN",
    "GILD","VRTX","MRNA","ILMN","DXCM","ZS","FTNT","TEAM","WDAY","DDOG","NET","TTD","ROKU",
    "DASH","RBLX","RIVN","LCID","SOFI","HOOD","CELH","MSTR","ON","ENPH","FSLR","CEG","CPRT",
    "ODFL","FAST","MNST","KDP","MAR","LULU","ROST","ORLY","ASML","PDD","JD","BIDU","NTES",
    "AZN","CHTR",
  ];

  // 2. Load portfolios (may be empty pre-competition)
  console.log('📂 Loading portfolios from Firebase...');
  const portfoliosRaw = await fbGet('portfolios');
  const portfolios = portfoliosRaw
    ? Object.entries(portfoliosRaw).map(([id, data]) => ({ id, ...data }))
    : [];
  console.log(`  Found ${portfolios.length} portfolios`);

  // 3. Merge universe + any custom tickers from portfolios
  const allTickers = [...new Set([...UNIVERSE, ...portfolios.flatMap(p => p.tickers)])];
  console.log(`  ${allTickers.length} total tickers to fetch\n`);

  // 4. Load existing prices
  const existingPricesRaw = await fbGet('prices');
  const prices = decObj(existingPricesRaw) || {};

  // 5. Fetch prices from Yahoo Finance
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
    // Small delay to avoid rate limiting (200ms × ~340 tickers ≈ 70s)
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n  ${successCount}/${allTickers.length} tickers updated`);

  // 6. Write prices to Firebase
  console.log('\n💾 Saving prices to Firebase...');
  await fbSet('prices', encObj(prices));
  console.log('  ✓ Prices saved');

  // 7. Calculate portfolio returns and save history snapshot (only during live competition)
  if (!preComp && portfolios.length > 0) {
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
  } else {
    console.log('\n⏳ Skipping return calculations (pre-competition)');
  }

  console.log('\n✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
