// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const db = require('./db');
const util = require('util');
const execFileAsync = util.promisify(execFile);

const app = express();
const port = 3001;

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.use(cors());
app.use(express.json());

app.get('/api/stock/:symbol', async (req, res) => {

  try {
    const { symbol } = req.params;
    const { date_range = 'max', interval = '1d', auto_predict = 'false' } = req.query;
    
    const cacheKey = `${symbol}-${date_range}-${interval}-${auto_predict}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
      console.log('Returning cached data for:', cacheKey);
      return res.json(cachedData.data);
    }
    
    const pythonArgs = [path.join(__dirname, '../analysis/stock_data.py'), 'get_stock_price_history', symbol, date_range, interval, auto_predict];
  
    execFile('python', pythonArgs,{maxBuffer:1024*1024*10}, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing Python script:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }

      console.log('Python stdout length:', stdout.length);
      console.log('Python stderr:', stderr);

      try {
        const result = JSON.parse(stdout);
        
        // Cache the result
        cache.set(cacheKey, {
          timestamp: Date.now(),
          data: result
        });

        res.json(result);
      } catch (parseError) {
        console.error('Error parsing Python output:', parseError);
        res.status(500).json({ error: 'Invalid data format from Python script' });
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    let { symbol, price, amount } = req.body;
    const queryText = 'INSERT INTO orders (type, symbol, price, amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING price';
    const values = ['buy', symbol, price, amount, false];
    const dbResult = await db.query(queryText, values);
    const finalPrice = dbResult.rows[0].price;
    res.json({ success: true, message: 'Order submitted successfully', price: finalPrice });

  } catch (error) {
    console.error('Error submitting order:', error);
    res.status(500).json({ error: 'Failed to submit order' });
  }
});

app.get('/api/portfolio', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, symbol, type, quantity, average_price FROM portfolio ORDER BY symbol ASC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

// ---------------------------------------------------------------------------
// Order-fill polling job
// ---------------------------------------------------------------------------
const ORDER_CHECK_INTERVAL_MS = 5000; // 5 seconds
let orderCheckRunning = false;

/**
 * Call Python get_current_stock_price for a single symbol.
 * Returns the numeric price, or null on any failure.
 */
async function fetchCurrentPrice(symbol) {
  const pythonArgs = [
    path.join(__dirname, '../analysis/stock_data.py'),
    'get_current_stock_price',
    symbol,
  ];
  try {
    const { stdout } = await execFileAsync('python', pythonArgs, { maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (result.error) {
      console.error(`[order-fill] Python error for ${symbol}:`, result.error);
      return null;
    }
    return result.price;
  } catch (err) {
    console.error(`[order-fill] Failed to get price for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Main polling job: checks open buy orders and fills qualifying ones.
 * Groups orders by symbol so Python is called once per distinct symbol.
 * Batch-updates all qualifying order IDs per symbol in a single query.
 */
async function processOpenBuyOrders() {
  if (orderCheckRunning) {
    console.log('[order-fill] Previous run still in progress, skipping.');
    return;
  }
  orderCheckRunning = true;

  try {
    // 1. Fetch all unfilled buy orders
    const { rows: openOrders } = await db.query(
      "SELECT id, symbol, price, amount FROM orders WHERE type = 'buy' AND status = false"
    );

    if (openOrders.length === 0) return; // nothing to do

    console.log(`[order-fill] Checking ${openOrders.length} open buy order(s)...`);

    // 2. Group orders by symbol
    const bySymbol = {};
    for (const order of openOrders) {
      if (!bySymbol[order.symbol]) bySymbol[order.symbol] = [];
      bySymbol[order.symbol].push(order);
    }

    // 3. Process each symbol group
    for (const [symbol, orders] of Object.entries(bySymbol)) {
      // Fetch current market price once per symbol
      const currentPrice = await fetchCurrentPrice(symbol);
      if (currentPrice === null) continue; // skip symbol on Python failure

      console.log(`[order-fill] ${symbol} current price: ${currentPrice}`);

      // 4. Filter orders where order.price >= currentPrice (buy fill condition)
      const toFill = orders.filter(o => o.price >= currentPrice);

      if (toFill.length === 0) {
        console.log(`[order-fill] ${symbol}: no orders qualify (${orders.length} checked)`);
        continue;
      }

      // 5. Batch-update all qualifying orders for this symbol in one query
      const ids = toFill.map(o => o.id);
      await db.query(
        'UPDATE orders SET status = true WHERE id = ANY($1::bigint[])',
        [ids]
      );

      // 6. Upsert portfolio using current market price as the fill price
      //    Weighted average: new_avg = (old_total_cost + fill_price * new_qty) / (old_qty + new_qty)
      const totalFilledQty = toFill.reduce((sum, o) => sum + o.amount, 0);
      const fillCost = currentPrice * totalFilledQty;

      await db.query(
        `INSERT INTO portfolio (symbol, type, quantity, average_price)
         VALUES ($1, 'buy', $2, $3)
         ON CONFLICT (symbol) DO UPDATE SET
           quantity      = portfolio.quantity + EXCLUDED.quantity,
           average_price = (portfolio.average_price * portfolio.quantity + $4) /
                           (portfolio.quantity + EXCLUDED.quantity)`,
        [symbol, totalFilledQty, currentPrice, fillCost]
      );

      console.log(
        `[order-fill] ${symbol}: filled ${toFill.length}/${orders.length} order(s)` +
        ` — ids: [${ids.join(', ')}], current price: ${currentPrice}`
      );
    }
  } catch (err) {
    console.error('[order-fill] Unexpected error:', err.message);
  } finally {
    orderCheckRunning = false;
  }
}

// Start the polling job
setInterval(processOpenBuyOrders, ORDER_CHECK_INTERVAL_MS);
console.log(`[order-fill] Polling job started — running every ${ORDER_CHECK_INTERVAL_MS / 1000}s`);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
