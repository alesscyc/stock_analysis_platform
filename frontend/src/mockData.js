/**
 * Generates realistic-looking NVDA OHLCV mock data.
 * ~252 trading days with trends, volatility, and moving averages.
 */

// Seeded pseudo-random for reproducible data
function createRng(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toFixed(n, decimals = 2) {
  return n.toFixed(decimals);
}

export function generateNvdaMockData() {
  const rng = createRng(42);
  const data = [];

  // Start ~1 year ago, NVDA in ~$100 range with upward trend
  const startDate = new Date('2025-05-09');
  let price = 105.0;
  let prevClose = price;

  // Last 252 trading days (approx 1 year), skipping weekends
  for (let i = 252; i >= 0; i--) {
    const d = new Date(startDate);
    d.setDate(d.getDate() - i);

    // Skip weekends
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;

    // Random walk with drift (+0.08% avg daily, ~20% annual)
    const drift = 0.0008;
    const volatility = 0.025;
    const noise = (rng() - 0.5) * 2; // -1 to 1
    const changePct = drift + noise * volatility;

    const open = prevClose;
    const close = open * (1 + changePct);
    const high = open * (1 + Math.abs(changePct) * (1 + rng() * 0.8));
    const low = close * (1 - Math.abs(changePct) * rng() * 1.2);
    const volume = Math.round(30000000 + rng() * 70000000);

    // Ensure high >= low
    const finalHigh = Math.max(high, low + 0.5);
    const finalLow = Math.min(low, finalHigh - 0.5);

    data.push({
      Date: formatDate(d),
      Open: toFixed(Math.max(open, 1)),
      High: toFixed(finalHigh),
      Low: toFixed(finalLow),
      Close: toFixed(close),
      Volume: String(volume),
    });

    prevClose = close;
    price = close;
  }

  // Compute moving averages
  const withMA = computeMovingAverages(data);
  return withMA;
}

function computeMovingAverages(data) {
  const periods = [
    { key: '10MA', days: 10 },
    { key: '20MA', days: 20 },
    { key: '50MA', days: 50 },
    { key: '150MA', days: 150 },
    { key: '200MA', days: 200 },
  ];

  const closes = data.map((d) => parseFloat(d.Close));
  const volumes = data.map((d) => parseFloat(d.Volume));

  return data.map((item, i) => {
    const out = { ...item };

    for (const { key, days } of periods) {
      if (i >= days - 1) {
        const sum = closes.slice(i - days + 1, i + 1).reduce((a, b) => a + b, 0);
        out[key] = toFixed(sum / days);
      }
    }

    // Volume 20-period MA
    if (i >= 19) {
      const sum = volumes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0);
      out['vol20MA'] = toFixed(sum / 20);
    }

    // Add a mock prediction
    if (i === data.length - 1) {
      out['prediction'] = {
        status: 'success',
        recommendation: 'BUY',
        confidence: '67',
        rawPrediction: 1,
      };
    }

    return out;
  });
}
