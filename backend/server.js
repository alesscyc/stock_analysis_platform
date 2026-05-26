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
const TERMINAL_ORDER_STATUSES = new Set(['Filled', 'Cancelled', 'ApiCancelled', 'Rejected']);

// Interactive Brokers Gateway portfolio cache
const IB_HOST = process.env.IB_HOST;
const IB_PORT = Number(process.env.IB_PORT);
const IB_CLIENT_ID = Number(process.env.IB_CLIENT_ID);
const IB_PORTFOLIO_SYNC_TIMEOUT_MS = Number(process.env.IB_PORTFOLIO_SYNC_TIMEOUT_MS) || 30000;
const IB_ORDER_ID_WAIT_TIMEOUT_MS = Number(process.env.IB_ORDER_ID_WAIT_TIMEOUT_MS) || 15000;
const IB_OPEN_ORDERS_SYNC_TIMEOUT_MS = Number(process.env.IB_OPEN_ORDERS_SYNC_TIMEOUT_MS) || 15000;

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

let ibAccount = null;

let portfolioRowsByKey = new Map();
let portfolioReady = false;
let lastPortfolioError = null;
let lastPortfolioUpdatedAt = null;
const portfolioWaiters = new Set();

// Open orders tracking
let openOrdersById = new Map();
let openOrdersReady = false;
let openOrdersSnapshotInFlight = false;
let lastOpenOrdersError = null;
let lastOpenOrdersUpdatedAt = null;
let autoOpenOrdersWarningShown = false;
const openOrdersWaiters = new Set();

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

function getOpenOrderKey(orderId, order) {
  const permId = Number(order?.permId);
  return Number.isFinite(permId) && permId > 0 ? `perm:${permId}` : `order:${orderId}`;
}

function getOpenOrderKeyFromValues(orderId, permId) {
  const normalizedPermId = Number(permId);
  return Number.isFinite(normalizedPermId) && normalizedPermId > 0 ? `perm:${normalizedPermId}` : `order:${orderId}`;
}

function findOpenOrderEntry(orderRef) {
  const normalizedRef = String(orderRef ?? '').trim();
  if (!normalizedRef) return null;

  const exactOrder = openOrdersById.get(normalizedRef);
  if (exactOrder) return [normalizedRef, exactOrder];

  const numericRef = Number(normalizedRef);
  if (Number.isInteger(numericRef)) {
    const numericKeyOrder = openOrdersById.get(numericRef);
    if (numericKeyOrder) return [numericRef, numericKeyOrder];

    const matchingEntries = Array.from(openOrdersById.entries())
      .filter(([, order]) => order.orderId === numericRef || order.permId === numericRef);

    if (matchingEntries.length === 1) {
      return matchingEntries[0];
    }
  }

  return null;
}

function findOpenOrderEntryByStatus(orderId, permId) {
  const orderKey = getOpenOrderKeyFromValues(orderId, permId);
  const exactOrder = openOrdersById.get(orderKey);
  if (exactOrder) return [orderKey, exactOrder];

  const matches = Array.from(openOrdersById.entries()).filter(([, order]) => {
    if (Number.isFinite(Number(permId)) && Number(permId) > 0) {
      return order.permId === Number(permId) || order.orderId === orderId;
    }
    return order.orderId === orderId;
  });

  return matches.length === 1 ? matches[0] : null;
}

function hasAmbiguousIbOrderId(order) {
  return Array.from(openOrdersById.values())
    .filter((candidate) => candidate.orderId === order.orderId)
    .length > 1;
}

function trackSubmittedOpenOrder(orderId, order) {
  const orderKey = getOpenOrderKeyFromValues(orderId, order.permId);
  openOrdersById.set(orderKey, {
    id: orderKey,
    permId: null,
    ...order,
    orderId,
  });
}

function resolveOpenOrdersWaiters() {
  const orders = getOpenOrders();

  for (const waiter of openOrdersWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(orders);
  }

  openOrdersWaiters.clear();
}

function rejectOpenOrdersWaiters(message) {
  for (const waiter of openOrdersWaiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }

  openOrdersWaiters.clear();
}

function finalizeOpenOrdersSnapshot() {
  openOrdersReady = true;
  openOrdersSnapshotInFlight = false;
  lastOpenOrdersError = null;
  lastOpenOrdersUpdatedAt = Date.now();

  resolveOpenOrdersWaiters();
}

function failOpenOrdersSnapshot(message) {
  openOrdersReady = false;
  openOrdersSnapshotInFlight = false;
  lastOpenOrdersError = message;
  lastOpenOrdersUpdatedAt = null;

  rejectOpenOrdersWaiters(message);
}

function requestOpenOrdersSnapshot() {
  if (!ibConnected) {
    failOpenOrdersSnapshot('IB Gateway is not connected');
    return;
  }

  if (openOrdersSnapshotInFlight) return;

  openOrdersById = new Map();
  openOrdersReady = false;
  openOrdersSnapshotInFlight = true;
  lastOpenOrdersError = null;

  if (IB_CLIENT_ID === 0) {
    ib.reqAutoOpenOrders(true);
  } else if (!autoOpenOrdersWarningShown) {
    autoOpenOrdersWarningShown = true;
    console.warn('[ib] To include manual TWS/IBKR open orders, connect with IB_CLIENT_ID=0 so reqAutoOpenOrders(true) can bind them');
  }

  ib.reqAllOpenOrders();
}

function waitForOpenOrdersSnapshot(timeoutMs = IB_OPEN_ORDERS_SYNC_TIMEOUT_MS, forceRefresh = false) {
  if (openOrdersReady && !forceRefresh) {
    return Promise.resolve(getOpenOrders());
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      openOrdersWaiters.delete(waiter);
      reject(new Error(`Timed out waiting for IB open orders on ${IB_HOST}:${IB_PORT}`));
    }, timeoutMs);

    openOrdersWaiters.add(waiter);

    try {
      requestOpenOrdersSnapshot();
    } catch (error) {
      openOrdersWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      failOpenOrdersSnapshot(error.message);
      reject(error);
    }
  });
}

function normalizeOrderPrice(price) {
  const value = Number(price);
  return Number.isFinite(value) && value > 0 && Math.abs(value) < 1e100 ? value : null;
}

function serializeOpenOrder(orderId, contract, order, orderState, existingOrder) {
  const limitPrice = normalizeOrderPrice(order?.lmtPrice)
    ?? normalizeOrderPrice(order?.auxPrice)
    ?? normalizeOrderPrice(existingOrder?.limitPrice);
  const permId = Number(order?.permId || existingOrder?.permId || 0);

  return {
    id: getOpenOrderKey(orderId, order),
    orderId,
    permId: Number.isFinite(permId) && permId > 0 ? permId : null,
    symbol: contract?.symbol || 'UNKNOWN',
    action: order?.action || 'UNKNOWN',
    orderType: order?.orderType || existingOrder?.orderType || 'UNKNOWN',
    quantity: Number(order?.totalQuantity || order?.qty || 0),
    limitPrice,
    status: orderState?.status || 'UNKNOWN',
    filled: Number(orderState?.filled || 0),
    remaining: Number(orderState?.remaining || 0),
    parentId: Number(order?.parentId || existingOrder?.parentId || 0),
    bracketRole: existingOrder?.bracketRole,
  };
}

function resetOpenOrders() {
  openOrdersById = new Map();
  openOrdersReady = false;
  openOrdersSnapshotInFlight = false;
  lastOpenOrdersError = null;
  lastOpenOrdersUpdatedAt = null;
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

function buildLimitOrder(action, quantity, price, tif, transmit = true) {
  const order = ib.order.limit(action, quantity, price, transmit);
  order.tif = tif;
  order.transmit = transmit;
  if (ibAccount) {
    order.account = ibAccount;
  }
  return order;
}

function getOppositeAction(action) {
  return action === 'BUY' ? 'SELL' : 'BUY';
}

function buildBracketOrders(action, quantity, entryPrice, takeProfitPrice, stopLossPrice, tif, parentOrderId) {
  const exitAction = getOppositeAction(action);
  const parentOrder = buildLimitOrder(action, quantity, entryPrice, tif, false);
  const takeProfitOrder = buildLimitOrder(exitAction, quantity, takeProfitPrice, tif, false);
  const stopLossOrder = {
    action: exitAction,
    totalQuantity: quantity,
    orderType: 'STP',
    auxPrice: stopLossPrice,
    parentId: parentOrderId,
    tif,
    transmit: true,
  };

  if (ibAccount) {
    stopLossOrder.account = ibAccount;
  }

  takeProfitOrder.parentId = parentOrderId;

  return [parentOrder, takeProfitOrder, stopLossOrder];
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
      ib.reqManagedAccts();
      requestOpenOrdersSnapshot();
    } catch (error) {
      requestingNextOrderId = false;
      failPortfolioSnapshot(error.message);
      failOpenOrdersSnapshot(error.message);
      scheduleReconnect();
    }
  });
});

ib.on('managedAccounts', (accountsList) => {
  if (accountsList) {
    const accounts = String(accountsList).split(',').map(s => s.trim()).filter(Boolean);
    if (accounts.length > 1) {
      ibAccount = accounts[1];
      console.log(`[ib] Multiple accounts detected. Using second account: ${ibAccount}`);
    } else if (accounts.length === 1) {
      ibAccount = accounts[0];
      console.log(`[ib] Account resolved: ${ibAccount}`);
    }
  }
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
    failOpenOrdersSnapshot('IB Gateway disconnected');
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

  if (openOrdersSnapshotInFlight) {
    failOpenOrdersSnapshot(message);
  }

  if (!ibConnected) {
    ibConnecting = false;
    nextOrderId = null;
    requestingNextOrderId = false;
    rejectOrderIdWaiters(message);
    scheduleReconnect();
  }
});

ib.on('orderStatus', (id, status, filled, remaining, avgFillPrice, permId) => {
  console.log(
    `[ib] Order ${id} status=${status} filled=${filled} remaining=${remaining} avgFillPrice=${avgFillPrice}`
  );

  const orderEntry = findOpenOrderEntryByStatus(id, permId);
  
  // Inactive bracket children are still active orders in IB, so keep them visible.
  if (TERMINAL_ORDER_STATUSES.has(status)) {
    if (orderEntry) {
      openOrdersById.delete(orderEntry[0]);
    }
    return;
  }

  const existingOrder = orderEntry?.[1];
  if (existingOrder) {
    openOrdersById.set(orderEntry[0], {
      ...existingOrder,
      status,
      filled: Number(filled || 0),
      remaining: Number(remaining || existingOrder.remaining || 0),
      avgFillPrice: Number(avgFillPrice || 0),
    });
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
  const orderKey = getOpenOrderKey(orderId, order);
  const serialized = serializeOpenOrder(orderId, contract, order, orderState, openOrdersById.get(orderKey));
  openOrdersById.set(orderKey, serialized);
  const priceLabel = serialized.limitPrice == null ? 'market' : `$${serialized.limitPrice}`;
  const permIdLabel = serialized.permId ? ` permId=${serialized.permId}` : '';
  console.log(`[ib] Open order ${orderId}${permIdLabel}: ${serialized.symbol} ${serialized.action} ${serialized.orderType} ${serialized.quantity} @ ${priceLabel} (status: ${serialized.status})`);
});

ib.on('openOrderEnd', () => {
  if (!ibConnected) return;
  finalizeOpenOrdersSnapshot();
  const updatedAt = lastOpenOrdersUpdatedAt
    ? new Date(lastOpenOrdersUpdatedAt).toISOString()
    : 'unknown';
  console.log(`[ib] Open orders snapshot complete with ${getOpenOrders().length} order(s) at ${updatedAt}`);
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

app.get('/api/ib/status', (req, res) => {
  res.json({ connected: ibConnected });
});

// ── Lightweight current price endpoint (for watchlist polling) ──────────────
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    const cacheKey = `price-${symbol}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < 30000)) {
      return res.json(cachedData.data);
    }

    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/current_price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });

    if (!pyRes.ok) {
      const errBody = await pyRes.json().catch(() => ({}));
      return res.status(502).json({ error: errBody.detail || 'Python service error' });
    }

    const result = await pyRes.json();
    cache.set(cacheKey, { timestamp: Date.now(), data: result });
    res.json(result);
  } catch (error) {
    console.error('[python-service] Price fetch failed:', error.message);
    res.status(502).json({ error: 'Could not reach Python analysis service' });
  }
});

// ── Fundamental data endpoint ───────────────────────────────────────────────
app.get('/api/fundamentals/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    const cacheKey = `fundamentals-${symbol}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < 24 * 60 * 60 * 1000)) {
      console.log('Returning cached fundamentals for:', symbol);
      return res.json(cachedData.data);
    }

    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/fundamentals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });

    if (!pyRes.ok) {
      const errBody = await pyRes.json().catch(() => ({}));
      return res.status(502).json({ error: errBody.detail || 'Python service error' });
    }

    const result = await pyRes.json();
    cache.set(cacheKey, { timestamp: Date.now(), data: result });
    res.json(result);
  } catch (error) {
    console.error('[python-service] Fundamentals fetch failed:', error.message);
    res.status(502).json({ error: 'Could not reach Python analysis service' });
  }
});

// ── Model cache status / retrain endpoints ──────────────────────────────────
app.get('/api/model/status/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/model/status/${encodeURIComponent(symbol)}`);
    const result = await pyRes.json();
    res.json(result);
  } catch (error) {
    console.error('[python-service] Model status failed:', error.message);
    res.status(502).json({ error: 'Could not reach Python analysis service' });
  }
});

app.post('/api/model/retrain/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    // Also clear any cached stock data so next request retrains
    for (const key of cache.keys()) {
      if (key.startsWith(`${symbol}-`) && key.includes('-true')) {
        cache.delete(key);
      }
    }

    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/model/retrain/${encodeURIComponent(symbol)}`, {
      method: 'POST',
    });
    const result = await pyRes.json();
    res.json(result);
  } catch (error) {
    console.error('[python-service] Model retrain failed:', error.message);
    res.status(502).json({ error: 'Could not reach Python analysis service' });
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
    const bracket = body.bracket && typeof body.bracket === 'object' ? body.bracket : null;
    const isBracketOrder = Boolean(bracket);
    const takeProfitPrice = Number(bracket?.takeProfitPrice ?? body.takeProfitPrice);
    const stopLossPrice = Number(bracket?.stopLossPrice ?? body.stopLossPrice);

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

    if (isBracketOrder) {
      if (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0) {
        return res.status(400).json({ error: 'Take-profit price must be a positive number' });
      }

      if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
        return res.status(400).json({ error: 'Stop-loss price must be a positive number' });
      }

      if (action === 'BUY' && takeProfitPrice <= price) {
        return res.status(400).json({ error: 'Take-profit price must be above entry price for buy brackets' });
      }

      if (action === 'BUY' && stopLossPrice >= price) {
        return res.status(400).json({ error: 'Stop-loss price must be below entry price for buy brackets' });
      }

      if (action === 'SELL' && takeProfitPrice >= price) {
        return res.status(400).json({ error: 'Take-profit price must be below entry price for sell brackets' });
      }

      if (action === 'SELL' && stopLossPrice <= price) {
        return res.status(400).json({ error: 'Stop-loss price must be above entry price for sell brackets' });
      }
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

      if (isBracketOrder) {
        const [parentOrder, takeProfitOrder, stopLossOrder] = buildBracketOrders(
          action,
          quantity,
          price,
          takeProfitPrice,
          stopLossPrice,
          tif,
          orderId
        );

        const takeProfitOrderId = orderId + 1;
        const stopLossOrderId = orderId + 2;

        trackSubmittedOpenOrder(orderId, {
          orderId,
          symbol,
          action,
          orderType: 'LMT',
          quantity,
          limitPrice: price,
          status: 'Submitted',
          filled: 0,
          remaining: quantity,
          parentId: 0,
          bracketRole: 'parent',
        });

        trackSubmittedOpenOrder(takeProfitOrderId, {
          orderId: takeProfitOrderId,
          symbol,
          action: takeProfitOrder.action,
          orderType: 'LMT',
          quantity,
          limitPrice: takeProfitPrice,
          status: 'Submitted',
          filled: 0,
          remaining: quantity,
          parentId: orderId,
          bracketRole: 'takeProfit',
        });

        trackSubmittedOpenOrder(stopLossOrderId, {
          orderId: stopLossOrderId,
          symbol,
          action: stopLossOrder.action,
          orderType: 'STP',
          quantity,
          limitPrice: stopLossPrice,
          status: 'Submitted',
          filled: 0,
          remaining: quantity,
          parentId: orderId,
          bracketRole: 'stopLoss',
        });

        ib.placeOrder(orderId, contract, parentOrder);
        ib.placeOrder(takeProfitOrderId, contract, takeProfitOrder);
        ib.placeOrder(stopLossOrderId, contract, stopLossOrder);
        nextOrderId = orderId + 3;

        console.log(
          `[ib] Submitted ${action} bracket ${orderId}/${takeProfitOrderId}/${stopLossOrderId} for ${symbol} quantity=${quantity} entry=${price} takeProfit=${takeProfitPrice} stopLoss=${stopLossPrice} tif=${tif}`
        );

        return {
          success: true,
          message: `Bracket order submitted to IB Gateway (parent orderId ${orderId})`,
          orderId,
          childOrderIds: [takeProfitOrderId, stopLossOrderId],
          orderType: 'BRACKET',
          symbol,
          action,
          quantity,
          price,
          takeProfitPrice,
          stopLossPrice,
          tif,
        };
      }

      trackSubmittedOpenOrder(orderId, {
        orderId,
        symbol,
        action,
        orderType: 'LMT',
        quantity,
        limitPrice: price,
        status: 'Submitted',
        filled: 0,
        remaining: quantity,
      });

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

app.get('/api/orders/pending', async (req, res) => {
  try {
    if (!ibConnected) {
      return res.status(503).json({ error: 'IB Gateway is not connected' });
    }
    
    const orders = await waitForOpenOrdersSnapshot(IB_OPEN_ORDERS_SYNC_TIMEOUT_MS, true);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching pending IB orders:', error);
    res.status(503).json({ error: lastOpenOrdersError || error.message || 'Failed to fetch pending orders from IB Gateway' });
  }
});

app.post('/api/orders/:orderRef/cancel', async (req, res) => {
  try {
    const orderRef = decodeURIComponent(String(req.params.orderRef ?? '').trim());

    if (!orderRef) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    if (!ibConnected) {
      return res.status(503).json({ error: 'IB Gateway is not connected' });
    }

    const orderEntry = findOpenOrderEntry(orderRef);
    const order = orderEntry?.[1];
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderId = Number(order.orderId);
    if (!Number.isInteger(orderId) || orderId < 0) {
      return res.status(400).json({ error: 'Invalid IB order ID' });
    }

    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      return res.status(400).json({ error: `Order is already ${order.status.toLowerCase()}` });
    }

    if (hasAmbiguousIbOrderId(order)) {
      return res.status(409).json({
        error: 'IB returned duplicate order IDs for open orders; cancel this order in IB Gateway/TWS to avoid cancelling the wrong order',
      });
    }

    ib.cancelOrder(orderId);
    console.log(`[ib] Cancel request sent for order ${orderId}`);

    res.json({
      success: true,
      message: `Cancel request sent for order ${orderId}`,
      orderId,
      id: order.id,
      permId: order.permId,
    });
  } catch (error) {
    console.error('Error cancelling IB order:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel order' });
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
