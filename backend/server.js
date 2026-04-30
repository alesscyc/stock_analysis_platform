// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const IB = require('ib');

const app = express();
const port = 3001;

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ALLOWED_ORDER_ACTIONS = new Set(['BUY', 'SELL']);
const ALLOWED_TIME_IN_FORCE = new Set(['DAY', 'GTC', 'IOC', 'FOK']);

// Interactive Brokers Gateway portfolio cache
const IB_HOST = process.env.IB_HOST;
const IB_PORT = Number(process.env.IB_PORT);
const IB_CLIENT_ID = Number(process.env.IB_CLIENT_ID);
const IB_PORTFOLIO_SYNC_TIMEOUT_MS = Number(process.env.IB_PORTFOLIO_SYNC_TIMEOUT_MS);
const IB_ORDER_ID_WAIT_TIMEOUT_MS = Number(process.env.IB_ORDER_ID_WAIT_TIMEOUT_MS);

// Finnhub API key for symbol search
const FINNHUB_KEY = process.env.FINNHUB_KEY;

// Python FastAPI microservice URL
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';

const ib = new IB({
  host: IB_HOST,
  port: IB_PORT,
  clientId: IB_CLIENT_ID,
});

let ibConnecting = false;
let ibConnected = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let nextOrderId = null;
let requestingNextOrderId = false;
const orderIdWaiters = new Set();
let orderPlacementQueue = Promise.resolve();

let portfolioRowsByKey = new Map();
let portfolioReady = false;
let lastPortfolioError = null;
let lastPortfolioUpdatedAt = null;
const portfolioWaiters = new Set();

// Open orders tracking
let openOrdersById = new Map();
let openOrdersReady = false;

function resetPortfolioSnapshot() {
  portfolioRowsByKey = new Map();
  portfolioReady = false;
}

function getPortfolioRows() {
  return Array.from(portfolioRowsByKey.values()).sort((a, b) => {
    const accountCompare = a.account.localeCompare(b.account);
    if (accountCompare !== 0) return accountCompare;
    return a.symbol.localeCompare(b.symbol);
  });
}

function resolvePortfolioWaiters() {
  const rows = getPortfolioRows();

  for (const waiter of portfolioWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(rows);
  }

  portfolioWaiters.clear();
}

function rejectPortfolioWaiters(message) {
  for (const waiter of portfolioWaiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }

  portfolioWaiters.clear();
}

function finalizePortfolioSnapshot() {
  portfolioReady = true;
  lastPortfolioError = null;
  lastPortfolioUpdatedAt = Date.now();

  resolvePortfolioWaiters();
}

function failPortfolioSnapshot(message) {
  rejectPortfolioWaiters(message);
  resetPortfolioSnapshot();
  portfolioReady = false;
  lastPortfolioError = message;
  lastPortfolioUpdatedAt = null;
}

function waitForPortfolioSnapshot(timeoutMs = IB_PORTFOLIO_SYNC_TIMEOUT_MS) {
  if (portfolioReady) {
    return Promise.resolve(getPortfolioRows());
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      portfolioWaiters.delete(waiter);
      reject(new Error(`Timed out waiting for IB portfolio on ${IB_HOST}:${IB_PORT}`));
    }, timeoutMs);

    portfolioWaiters.add(waiter);
  });
}

function serializePortfolioRow(row) {
  return {
    id: row.id,
    account: row.account,
    symbol: row.symbol,
    type: row.type,
    quantity: row.quantity,
    avgCost: row.avgCost,
    average_price: row.avgCost,
    costBasis: row.costBasis,
    cost_basis: row.costBasis,
    currency: row.currency,
    exchange: row.exchange,
    secType: row.secType,
  };
}

function getOpenOrders() {
  return Array.from(openOrdersById.values()).sort((a, b) => a.orderId - b.orderId);
}

function serializeOpenOrder(orderId, contract, order, orderState) {
  return {
    orderId,
    symbol: contract?.symbol || 'UNKNOWN',
    action: order?.action || 'UNKNOWN',
    quantity: Number(order?.totalQuantity || order?.qty || 0),
    limitPrice: Number(order?.lmtPrice || 0),
    status: orderState?.status || 'UNKNOWN',
    filled: Number(orderState?.filled || 0),
    remaining: Number(orderState?.remaining || 0),
  };
}

function resetOpenOrders() {
  openOrdersById = new Map();
  openOrdersReady = false;
}


function resolveOrderIdWaiters(orderId) {
  for (const waiter of orderIdWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(orderId);
  }

  orderIdWaiters.clear();
}

function rejectOrderIdWaiters(message) {
  for (const waiter of orderIdWaiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }

  orderIdWaiters.clear();
}

function waitForNextOrderId(timeoutMs = IB_ORDER_ID_WAIT_TIMEOUT_MS) {
  if (nextOrderId !== null) {
    return Promise.resolve(nextOrderId);
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      orderIdWaiters.delete(waiter);
      requestingNextOrderId = false;
      reject(new Error('Timed out waiting for next IB order id'));
    }, timeoutMs);

    orderIdWaiters.add(waiter);
  });
}

function enqueueOrderPlacement(task) {
  const run = orderPlacementQueue.then(() => task());
  orderPlacementQueue = run.catch(() => {});
  return run;
}

function normalizeTimeInForce(tif) {
  const normalized = String(tif || 'DAY').trim().toUpperCase();
  return ALLOWED_TIME_IN_FORCE.has(normalized) ? normalized : 'DAY';
}

function buildStockContract(symbol) {
  return ib.contract.stock(symbol, 'SMART', 'USD');
}

function buildLimitOrder(action, quantity, price, tif) {
  const order = ib.order.limit(action, quantity, price, true);
  order.tif = tif;
  return order;
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectAttempts += 1;
  const delayMs = Math.min(30000, 1000 * reconnectAttempts);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectIbGateway();
  }, delayMs);
}

function connectIbGateway() {
  if (ibConnecting || ibConnected) return;

  ibConnecting = true;

  try {
    console.log(`[ib] Connecting to IB Gateway at ${IB_HOST}:${IB_PORT} (clientId ${IB_CLIENT_ID})`);
    ib.connect();
  } catch (error) {
    ibConnecting = false;
    failPortfolioSnapshot(error.message);
    scheduleReconnect();
  }
}

function buildPortfolioKey(account, contract) {
  return [
    account || '',
    contract?.conId || '',
    contract?.symbol || '',
    contract?.localSymbol || '',
    contract?.secType || '',
    contract?.currency || '',
    contract?.exchange || '',
  ].join('|');
}

function normalizePortfolioRow(account, contract, position, avgCost) {
  const quantity = Number(position) || 0;
  const averageCost = Number(avgCost) || 0;
  const symbol = contract?.symbol || contract?.localSymbol || 'UNKNOWN';
  const type = quantity < 0 ? 'sell' : 'buy';
  const costBasis = Math.abs(quantity) * averageCost;

  return {
    id: buildPortfolioKey(account, contract),
    account: account || 'UNKNOWN',
    symbol,
    type,
    localSymbol: contract?.localSymbol || symbol,
    secType: contract?.secType || '',
    currency: contract?.currency || 'USD',
    exchange: contract?.exchange || '',
    quantity,
    avgCost: averageCost,
    costBasis,
  };
}

function upsertPortfolioPosition(account, contract, position, avgCost) {
  const row = normalizePortfolioRow(account, contract, position, avgCost);
  portfolioRowsByKey.set(row.id, row);
  lastPortfolioUpdatedAt = Date.now();
  lastPortfolioError = null;
}

ib.on('connected', () => {
  ibConnecting = false;
  ibConnected = true;
  reconnectAttempts = 0;
  lastPortfolioError = null;
  nextOrderId = null;
  requestingNextOrderId = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log(`[ib] Connected to IB Gateway at ${IB_HOST}:${IB_PORT}`);
  resetPortfolioSnapshot();
  resetOpenOrders();

  setImmediate(() => {
    try {
      requestingNextOrderId = true;
      ib.reqIds(1);
      ib.reqPositions();
      ib.reqAllOpenOrders();
    } catch (error) {
      requestingNextOrderId = false;
      failPortfolioSnapshot(error.message);
      scheduleReconnect();
    }
  });
});

ib.on('nextValidId', (orderId) => {
  const normalizedOrderId = Number(orderId);

  if (!Number.isInteger(normalizedOrderId)) {
    console.warn('[ib] Ignoring invalid nextValidId value:', orderId);
    return;
  }

  nextOrderId = normalizedOrderId;
  requestingNextOrderId = false;
  resolveOrderIdWaiters(nextOrderId);
  console.log(`[ib] Next order id ready: ${nextOrderId}`);
});

ib.on('disconnected', () => {
  const wasConnected = ibConnected || ibConnecting;
  ibConnecting = false;
  ibConnected = false;
  nextOrderId = null;
  requestingNextOrderId = false;
  rejectOrderIdWaiters('IB Gateway disconnected');

  if (wasConnected) {
    console.warn('[ib] Disconnected from IB Gateway');
    failPortfolioSnapshot('IB Gateway disconnected');
    scheduleReconnect();
  }
});

ib.on('error', (error) => {
  const message = error?.message || 'Unknown IB Gateway error';
  console.error('[ib] Error:', message);
  lastPortfolioError = message;

  if (!portfolioReady) {
    failPortfolioSnapshot(message);
  }

  if (!ibConnected) {
    ibConnecting = false;
    nextOrderId = null;
    requestingNextOrderId = false;
    rejectOrderIdWaiters(message);
    scheduleReconnect();
  }
});

ib.on('orderStatus', (id, status, filled, remaining, avgFillPrice) => {
  console.log(
    `[ib] Order ${id} status=${status} filled=${filled} remaining=${remaining} avgFillPrice=${avgFillPrice}`
  );
  
  // Remove order from tracking if it's filled, cancelled, or rejected
  if (['Filled', 'Cancelled', 'ApiCancelled', 'Rejected','Inactive'].includes(status)) {
    openOrdersById.delete(id);
  }
});

ib.on('position', (account, contract, position, avgCost) => {
  if (!ibConnected) return;
  upsertPortfolioPosition(account, contract, position, avgCost);
});

ib.on('positionEnd', () => {
  if (!ibConnected) return;
  finalizePortfolioSnapshot();

  const updatedAt = lastPortfolioUpdatedAt
    ? new Date(lastPortfolioUpdatedAt).toISOString()
    : 'unknown';
  console.log(`[ib] Portfolio snapshot updated with ${getPortfolioRows().length} position(s) at ${updatedAt}`);
});

ib.on('openOrder', (orderId, contract, order, orderState) => {
  if (!ibConnected) return;
  const serialized = serializeOpenOrder(orderId, contract, order, orderState);
  openOrdersById.set(orderId, serialized);
  console.log(`[ib] Open order ${orderId}: ${serialized.symbol} ${serialized.action} ${serialized.quantity} @ $${serialized.limitPrice} (status: ${serialized.status})`);
});

ib.on('openOrderEnd', () => {
  if (!ibConnected) return;
  openOrdersReady = true;
  console.log(`[ib] Open orders snapshot complete with ${getOpenOrders().length} order(s)`);
});

app.use(cors());
app.use(express.json());

app.get('/api/stock/:symbol', async (req, res) => {

  try {
    const { symbol } = req.params;
    const { date_range = 'max', interval = '1d', auto_predict = 'false' } = req.query;
    
    // Input validation / whitelist
    const ALLOWED_DATE_RANGES = new Set(['max', '1y', '2y', '5y']);
    const ALLOWED_INTERVALS = new Set(['1d', '1wk', '1mo']);

    const sanitizedSymbol = String(symbol).trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,20}$/.test(sanitizedSymbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    if (!ALLOWED_DATE_RANGES.has(date_range)) {
      return res.status(400).json({ error: 'Invalid date_range. Allowed: max, 1y, 2y, 5y' });
    }

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: 'Invalid interval. Allowed: 1d, 1wk, 1mo' });
    }

    const sanitizedAutoPredict = auto_predict === 'true' ? 'true' : 'false';
    
    const cacheKey = `${sanitizedSymbol}-${date_range}-${interval}-${sanitizedAutoPredict}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
      console.log('Returning cached data for:', cacheKey);
      return res.json(cachedData.data);
    }
    
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/stock_history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: sanitizedSymbol,
        date_range,
        interval,
        auto_predict: sanitizedAutoPredict === 'true',
      }),
    });

    if (!pyRes.ok) {
      const errBody = await pyRes.json().catch(() => ({}));
      console.error('[python-service] Error response:', pyRes.status, errBody);
      return res.status(502).json({ error: errBody.detail || 'Python service error' });
    }

    const result = await pyRes.json();
    console.log('[python-service] Response received, items:', Array.isArray(result) ? result.length : 'N/A');

    // Cache the result
    cache.set(cacheKey, { timestamp: Date.now(), data: result });

    res.json(result);

  } catch (error) {
    console.error('[python-service] Fetch failed:', error.message);
    res.status(502).json({ error: 'Could not reach Python analysis service. Is it running?' });
  }
});

app.get('/api/symbols', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.json([]);
    }

    const query = q.trim().substring(0, 50); // Limit query length
    const cacheKey = `symbols-${query}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
      console.log('Returning cached symbols for:', query);
      return res.json(cachedData.data);
    }

    if (!FINNHUB_KEY || FINNHUB_KEY === 'placeholder') {
      console.warn('FINNHUB_KEY not configured, returning empty suggestions');
      return res.json([]);
    }

    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Finnhub API error:', response.status, response.statusText);
      return res.json([]);
    }

    const data = await response.json();
    const results = (data.result || [])
      .slice(0, 10)
      .map(item => ({
        symbol: item.symbol || '',
        description: item.description || '',
      }))
      .filter(item => item.symbol.length > 0);

    // Cache the result
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: results,
    });

    res.json(results);
  } catch (error) {
    console.error('Error fetching symbols:', error);
    res.json([]);
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body ?? {};
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const action = String(body.action ?? 'BUY').trim().toUpperCase();
    const quantity = Number(body.quantity ?? body.amount);
    const price = Number(body.price);
    const tif = normalizeTimeInForce(body.tif);

    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    if (!ALLOWED_ORDER_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'Action must be BUY or SELL' });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'Price must be a positive number' });
    }

    if (!ibConnected) {
      return res.status(503).json({ error: 'IB Gateway is not connected' });
    }

    const result = await enqueueOrderPlacement(async () => {
      if (!ibConnected) {
        const error = new Error('IB Gateway is not connected');
        error.statusCode = 503;
        throw error;
      }

      if (nextOrderId === null) {
        if (!requestingNextOrderId) {
          try {
            requestingNextOrderId = true;
            ib.reqIds(1);
          } catch (requestError) {
            requestingNextOrderId = false;
            console.warn('[ib] Failed to request next order id:', requestError.message);
          }
        }

        await waitForNextOrderId();
      }

      if (nextOrderId === null) {
        const error = new Error('IB Gateway is not ready to accept orders yet');
        error.statusCode = 503;
        throw error;
      }

      const orderId = nextOrderId;
      const contract = buildStockContract(symbol);
      const order = buildLimitOrder(action, quantity, price, tif);

      ib.placeOrder(orderId, contract, order);
      nextOrderId = orderId + 1;

      console.log(
        `[ib] Submitted ${action} order ${orderId} for ${symbol} quantity=${quantity} price=${price} tif=${tif}`
      );

      return {
        success: true,
        message: `Order submitted to IB Gateway (orderId ${orderId})`,
        orderId,
        symbol,
        action,
        quantity,
        price,
        tif,
      };
    });

    res.json(result);

  } catch (error) {
    console.error('Error submitting IB order:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to submit order to IB Gateway' });
  }
});

app.get('/api/portfolio', async (req, res) => {
  try {
    const rows = await waitForPortfolioSnapshot();
    res.json(rows.map(serializePortfolioRow));
  } catch (error) {
    console.error('Error fetching IB portfolio:', error);
    res.status(503).json({ error: lastPortfolioError || error.message || 'Failed to fetch portfolio from IB Gateway' });
  }
});

app.get('/api/orders/pending', (req, res) => {
  try {
    if (!ibConnected) {
      return res.status(503).json({ error: 'IB Gateway is not connected' });
    }
    
    const orders = getOpenOrders();
    res.json(orders);
  } catch (error) {
    console.error('Error fetching pending IB orders:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch pending orders from IB Gateway' });
  }
});

connectIbGateway();

// ── Python FastAPI service manager ───────────────────────────────────────────
const PYTHON_SCRIPT = path.join(__dirname, '../analysis/stock_data.py');
let pythonProcess = null;
let pythonExiting = false;

function startPythonService() {
  if (pythonExiting) return;

  console.log('[python-service] Starting FastAPI service...');
  pythonProcess = spawn('python', [PYTHON_SCRIPT, 'serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProcess.stdout.on('data', (data) => {
    process.stdout.write(`[python-service] ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    process.stderr.write(`[python-service] ${data}`);
  });

  pythonProcess.on('exit', (code, signal) => {
    pythonProcess = null;
    if (!pythonExiting) {
      console.warn(`[python-service] Exited (code=${code} signal=${signal}), restarting in 2s...`);
      setTimeout(startPythonService, 2000);
    }
  });

  pythonProcess.on('error', (err) => {
    console.error('[python-service] Failed to start:', err.message);
  });
}

function stopPythonService() {
  pythonExiting = true;
  if (pythonProcess) {
    console.log('[python-service] Stopping...');
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  }
}

function shutdown(signal) {
  console.log(`\n[server] Received ${signal}, shutting down...`);
  stopPythonService();
  try { ib.disconnect(); } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

startPythonService();

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
