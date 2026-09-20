export const PAPER_ACCOUNT_KEY = 'stockai-paper-account-v1';
export const PAPER_MODE_KEY = 'stockai-trading-mode';
export const PAPER_ACCOUNT_VERSION = 1;
export const DEFAULT_PAPER_CASH = 100000;
export const PAPER_HISTORY_LIMIT = 500;

const OPEN_STATUSES = new Set(['Submitted', 'Inactive']);
const TERMINAL_STATUSES = new Set(['Filled', 'Cancelled', 'Expired', 'Rejected']);
const VALID_STATUSES = new Set([...OPEN_STATUSES, ...TERMINAL_STATUSES]);

export class PaperAccountError extends Error {}

const nowIso = (now = Date.now()) => new Date(now).toISOString();
const nextDay = (now) => {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.toISOString();
};
const clone = (value) => structuredClone(value);
const isPositiveMoney = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

export function createPaperAccount(startingCash = DEFAULT_PAPER_CASH, now = Date.now()) {
  const cash = Number(startingCash);
  if (!isPositiveMoney(cash)) throw new PaperAccountError('Starting cash must be a positive number');
  return {
    version: PAPER_ACCOUNT_VERSION,
    startingCash: cash,
    cash,
    realizedPnl: 0,
    holdings: {},
    orders: [],
    quotes: {},
    nextOrderId: 1,
    updatedAt: nowIso(now),
  };
}

export function validatePaperAccount(value) {
  if (!value || value.version !== PAPER_ACCOUNT_VERSION || !Number.isFinite(value.cash) || value.cash < 0
    || !isPositiveMoney(value.startingCash) || !Number.isFinite(value.realizedPnl)
    || !Number.isSafeInteger(value.nextOrderId) || value.nextOrderId < 1
    || !value.holdings || typeof value.holdings !== 'object' || Array.isArray(value.holdings)
    || !value.quotes || typeof value.quotes !== 'object' || Array.isArray(value.quotes)
    || !Array.isArray(value.orders)) return false;

  const ordersValid = value.orders.every((order) => (
    typeof order?.id === 'string' && /^[A-Z0-9.-]{1,20}$/.test(order.symbol)
    && ['BUY', 'SELL'].includes(order.action) && ['LMT', 'STP'].includes(order.orderType)
    && ['DAY', 'GTC', 'IOC', 'FOK'].includes(order.tif) && VALID_STATUSES.has(order.status)
    && Number.isSafeInteger(order.quantity) && order.quantity > 0
    && Number.isFinite(order.filled) && Number.isFinite(order.remaining)
    && order.filled >= 0 && order.remaining >= 0 && isPositiveMoney(order.limitPrice)
  ));
  return ordersValid && new Set(value.orders.map((order) => order.id)).size === value.orders.length
    && Object.entries(value.holdings).every(([symbol, row]) => (
      /^[A-Z0-9.-]{1,20}$/.test(symbol) && row?.symbol === symbol
      && Number.isSafeInteger(row.quantity) && row.quantity > 0 && isPositiveMoney(row.averageCost)
    ))
    && Object.entries(value.quotes).every(([symbol, quote]) => (
      /^[A-Z0-9.-]{1,20}$/.test(symbol) && isPositiveMoney(quote?.price)
      && Number.isFinite(Date.parse(quote?.timestamp))
    ));
}

export function loadPaperAccount(storage = localStorage, now = Date.now()) {
  let raw;
  try {
    raw = storage.getItem(PAPER_ACCOUNT_KEY);
  } catch {
    throw new PaperAccountError('Browser storage is unavailable');
  }
  if (raw == null) {
    const account = createPaperAccount(DEFAULT_PAPER_CASH, now);
    savePaperAccount(account, storage);
    return account;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!validatePaperAccount(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new PaperAccountError('Paper Account data is corrupt. Reset it before trading.');
  }
}

export function savePaperAccount(account, storage = localStorage) {
  if (!validatePaperAccount(account)) throw new PaperAccountError('Paper Account data is invalid');
  try {
    storage.setItem(PAPER_ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    throw new PaperAccountError('Paper Account could not be saved');
  }
}

export function getOpenPaperOrders(account) {
  return account.orders.filter((order) => OPEN_STATUSES.has(order.status));
}

export function getPaperOrderHistory(account) {
  return account.orders.filter((order) => TERMINAL_STATUSES.has(order.status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function trimHistory(account) {
  const terminal = getPaperOrderHistory(account);
  if (terminal.length <= PAPER_HISTORY_LIMIT) return;
  const activeParentIds = new Set(account.orders
    .filter((order) => order.parentId && OPEN_STATUSES.has(order.status))
    .map((order) => order.parentId));
  const keep = new Set(terminal.filter((order) => activeParentIds.has(order.id)).map((order) => order.id));
  for (const order of terminal) {
    if (keep.size >= PAPER_HISTORY_LIMIT) break;
    keep.add(order.id);
  }
  account.orders = account.orders.filter((order) => !TERMINAL_STATUSES.has(order.status) || keep.has(order.id));
}

function reservedCash(account, ignoredGroup = null) {
  return account.orders.reduce((sum, order) => {
    if (order.status !== 'Submitted' || order.action !== 'BUY' || order.parentId) return sum;
    if ((order.bracketId || order.id) === ignoredGroup) return sum;
    return sum + order.quantity * order.limitPrice;
  }, 0);
}

function reservedShares(account, symbol, ignoredGroup = null) {
  const groups = new Map();
  for (const order of account.orders) {
    if (order.status !== 'Submitted' || order.action !== 'SELL' || order.symbol !== symbol) continue;
    const group = order.bracketId || order.id;
    if (group === ignoredGroup) continue;
    groups.set(group, Math.max(groups.get(group) || 0, order.quantity));
  }
  return [...groups.values()].reduce((sum, quantity) => sum + quantity, 0);
}

function orderId(account) {
  const id = `paper:${account.nextOrderId}`;
  account.nextOrderId += 1;
  return id;
}

function baseOrder(account, payload, now, extra = {}) {
  const id = orderId(account);
  return {
    id,
    symbol: payload.symbol,
    action: payload.action,
    orderType: extra.orderType || 'LMT',
    quantity: payload.quantity,
    filled: 0,
    remaining: payload.quantity,
    limitPrice: extra.limitPrice ?? payload.price,
    tif: payload.tif,
    status: extra.status || 'Submitted',
    submittedAt: nowIso(now),
    updatedAt: nowIso(now),
    expiresAt: payload.tif === 'DAY' ? nextDay(now) : null,
    ...extra,
  };
}

function isMarketable(order, price) {
  if (order.orderType === 'STP') return order.action === 'SELL' ? price <= order.limitPrice : price >= order.limitPrice;
  return order.action === 'BUY' ? price <= order.limitPrice : price >= order.limitPrice;
}

function cancelBracket(account, bracketId, status, now, exceptId = null) {
  for (const order of account.orders) {
    if (order.bracketId === bracketId && order.id !== exceptId && OPEN_STATUSES.has(order.status)) {
      order.status = status;
      order.updatedAt = nowIso(now);
    }
  }
}

function fillOrder(account, order, quote, now) {
  const fillPrice = order.orderType === 'STP'
    ? quote
    : order.action === 'BUY' ? Math.min(order.limitPrice, quote) : Math.max(order.limitPrice, quote);
  if (order.action === 'BUY') {
    const holding = account.holdings[order.symbol];
    const oldQuantity = holding?.quantity || 0;
    const quantity = oldQuantity + order.quantity;
    account.cash -= fillPrice * order.quantity;
    account.holdings[order.symbol] = {
      symbol: order.symbol,
      quantity,
      averageCost: ((holding?.averageCost || 0) * oldQuantity + fillPrice * order.quantity) / quantity,
    };
  } else {
    const holding = account.holdings[order.symbol];
    account.cash += fillPrice * order.quantity;
    account.realizedPnl += (fillPrice - holding.averageCost) * order.quantity;
    holding.quantity -= order.quantity;
    if (holding.quantity === 0) delete account.holdings[order.symbol];
  }
  order.status = 'Filled';
  order.filled = order.quantity;
  order.remaining = 0;
  order.fillPrice = fillPrice;
  order.filledAt = nowIso(now);
  order.updatedAt = nowIso(now);

  if (order.bracketRole === 'parent') {
    for (const child of account.orders) {
      if (child.bracketId === order.bracketId && child.parentId === order.id) {
        child.status = 'Submitted';
        child.updatedAt = nowIso(now);
      }
    }
  } else if (order.bracketId) {
    cancelBracket(account, order.bracketId, 'Cancelled', now, order.id);
  }
}

export function expirePaperOrders(source, now = Date.now()) {
  const account = clone(source);
  for (const order of account.orders) {
    if (OPEN_STATUSES.has(order.status) && order.expiresAt && Date.parse(order.expiresAt) <= now) {
      if (order.bracketId) cancelBracket(account, order.bracketId, 'Expired', now);
      else {
        order.status = 'Expired';
        order.updatedAt = nowIso(now);
      }
    }
  }
  account.updatedAt = nowIso(now);
  trimHistory(account);
  return account;
}

export function applyPaperQuote(source, symbolValue, priceValue, now = Date.now()) {
  const symbol = String(symbolValue || '').trim().toUpperCase();
  const price = Number(priceValue);
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol) || !isPositiveMoney(price)) throw new PaperAccountError('Invalid quote');
  const account = expirePaperOrders(source, now);
  account.quotes[symbol] = { price, timestamp: nowIso(now) };

  for (const order of account.orders) {
    if (order.symbol !== symbol || order.status !== 'Submitted' || !isMarketable(order, price)) continue;
    if (order.action === 'BUY' && !order.parentId && account.cash < order.quantity * (order.orderType === 'STP' ? price : Math.min(price, order.limitPrice))) {
      order.status = 'Rejected';
      order.updatedAt = nowIso(now);
      if (order.bracketId) cancelBracket(account, order.bracketId, 'Cancelled', now, order.id);
      continue;
    }
    if (order.action === 'SELL' && (account.holdings[symbol]?.quantity || 0) < order.quantity) {
      order.status = 'Rejected';
      order.updatedAt = nowIso(now);
      if (order.bracketId) cancelBracket(account, order.bracketId, 'Cancelled', now, order.id);
      continue;
    }
    fillOrder(account, order, price, now);
  }
  account.updatedAt = nowIso(now);
  trimHistory(account);
  return account;
}

export function submitPaperOrder(source, rawPayload, quote = null, now = Date.now()) {
  const account = expirePaperOrders(source, now);
  const payload = {
    symbol: String(rawPayload?.symbol || '').trim().toUpperCase(),
    action: String(rawPayload?.action || 'BUY').trim().toUpperCase(),
    quantity: Number(rawPayload?.quantity ?? rawPayload?.amount),
    price: Number(rawPayload?.price ?? rawPayload?.stopPrice),
    orderType: String(rawPayload?.orderType || 'LMT').toUpperCase(),
    tif: String(rawPayload?.tif || 'DAY').trim().toUpperCase(),
    bracket: rawPayload?.bracket,
  };
  if (!/^[A-Z0-9.-]{1,20}$/.test(payload.symbol)) throw new PaperAccountError('Invalid symbol');
  if (!['BUY', 'SELL'].includes(payload.action)) throw new PaperAccountError('Action must be BUY or SELL');
  if (!Number.isSafeInteger(payload.quantity) || payload.quantity <= 0) throw new PaperAccountError('Quantity must be a positive integer');
  if (!isPositiveMoney(payload.price)) throw new PaperAccountError('Price must be a positive number');
  if (!['DAY', 'GTC', 'IOC', 'FOK'].includes(payload.tif)) payload.tif = 'DAY';
  if (payload.bracket && payload.action === 'SELL') throw new PaperAccountError('Paper Account does not support SELL brackets');
  if (payload.bracket && ['IOC', 'FOK'].includes(payload.tif)) throw new PaperAccountError('Paper brackets support DAY or GTC only');

  if (payload.action === 'BUY' && account.cash - reservedCash(account) < payload.quantity * payload.price) {
    throw new PaperAccountError('Insufficient available cash');
  }
  if (payload.action === 'SELL') {
    const available = (account.holdings[payload.symbol]?.quantity || 0) - reservedShares(account, payload.symbol);
    if (available < payload.quantity) throw new PaperAccountError('Insufficient available shares');
  }

  const standaloneType = payload.orderType;
  if (!['LMT', 'STP'].includes(standaloneType)) throw new PaperAccountError('Unsupported paper order type');
  const parent = baseOrder(account, payload, now, payload.bracket
    ? { bracketRole: 'parent' }
    : { orderType: standaloneType });
  if (payload.bracket) {
    const takeProfitPrice = Number(payload.bracket.takeProfitPrice);
    const stopLossPrice = Number(payload.bracket.stopLossPrice);
    if (!isPositiveMoney(takeProfitPrice) || takeProfitPrice <= payload.price
      || !isPositiveMoney(stopLossPrice) || stopLossPrice >= payload.price) {
      throw new PaperAccountError('Invalid paper bracket prices');
    }
    parent.bracketId = parent.id;
    account.orders.push(parent);
    account.orders.push(baseOrder(account, payload, now, {
      action: 'SELL', limitPrice: takeProfitPrice, status: 'Inactive', parentId: parent.id,
      bracketId: parent.id, bracketRole: 'takeProfit', tif: payload.tif,
    }));
    const stop = baseOrder(account, payload, now, {
      action: 'SELL', orderType: 'STP', limitPrice: stopLossPrice, status: 'Inactive', parentId: parent.id,
      bracketId: parent.id, bracketRole: 'stopLoss', tif: payload.tif,
    });
    account.orders.push(stop);
  } else account.orders.push(parent);

  let next = account;
  const storedQuote = account.quotes[payload.symbol];
  const freshStoredPrice = ['IOC', 'FOK'].includes(payload.tif)
    && storedQuote && now - Date.parse(storedQuote.timestamp) <= 60000 ? storedQuote.price : null;
  const executionQuote = isPositiveMoney(quote) ? Number(quote) : freshStoredPrice;
  if (isPositiveMoney(executionQuote)) next = applyPaperQuote(account, payload.symbol, executionQuote, now);
  const placed = next.orders.find((order) => order.id === parent.id);
  if (['IOC', 'FOK'].includes(payload.tif) && placed?.status !== 'Filled') {
    next = cancelPaperOrder(next, parent.id, now, 'Cancelled');
  }
  return {
    account: next,
    result: {
      success: true,
      orderId: parent.id,
      childOrderIds: next.orders.filter((order) => order.parentId === parent.id).map((order) => order.id),
      orderType: payload.bracket ? 'BRACKET' : standaloneType,
      symbol: payload.symbol,
      action: payload.action,
      quantity: payload.quantity,
      price: payload.price,
      tif: payload.tif,
      paper: true,
    },
  };
}

export function cancelPaperOrder(source, orderRef, now = Date.now(), status = 'Cancelled') {
  const account = clone(source);
  const order = account.orders.find((row) => row.id === String(orderRef));
  if (!order) throw new PaperAccountError('Order not found');
  if (!OPEN_STATUSES.has(order.status)) throw new PaperAccountError(`Order is already ${order.status.toLowerCase()}`);
  if (order.bracketId) cancelBracket(account, order.bracketId, status, now);
  else {
    order.status = status;
    order.updatedAt = nowIso(now);
  }
  account.updatedAt = nowIso(now);
  trimHistory(account);
  return account;
}

export function modifyPaperOrder(source, orderRef, priceValue, now = Date.now()) {
  if (priceValue && typeof priceValue === 'object') {
    if (priceValue.quantity != null) throw new PaperAccountError('Quantity changes require cancel-and-replace');
    priceValue = priceValue.price ?? priceValue.limitPrice;
  }
  const account = clone(source);
  const order = account.orders.find((row) => row.id === String(orderRef));
  const price = Number(priceValue);
  if (!order || order.status !== 'Submitted') throw new PaperAccountError('Open order not found');
  if (!isPositiveMoney(price)) throw new PaperAccountError('Price must be a positive number');
  const group = order.bracketId || order.id;
  if (order.action === 'BUY' && !order.parentId && account.cash - reservedCash(account, group) < order.quantity * price) {
    throw new PaperAccountError('Insufficient available cash');
  }
  order.limitPrice = price;
  order.updatedAt = nowIso(now);
  account.updatedAt = nowIso(now);
  return account;
}

export function buildPaperOverview(account, now = Date.now()) {
  const holdings = Object.values(account.holdings).map((holding) => {
    const quote = account.quotes[holding.symbol];
    const marketPrice = Number(quote?.price);
    const marketValue = Number.isFinite(marketPrice) ? marketPrice * holding.quantity : null;
    return {
      id: `paper:${holding.symbol}`,
      symbol: holding.symbol,
      quantity: holding.quantity,
      averageCost: holding.averageCost,
      avgCost: holding.averageCost,
      costBasis: holding.averageCost * holding.quantity,
      marketPrice: Number.isFinite(marketPrice) ? marketPrice : null,
      marketValue,
      unrealizedPnl: Number.isFinite(marketValue) ? marketValue - holding.averageCost * holding.quantity : null,
      currency: 'USD',
      quoteTimestamp: quote?.timestamp || null,
    };
  });
  const grossMarketValue = holdings.reduce((sum, row) => sum + (row.marketValue || 0), 0);
  const unrealizedPnl = holdings.reduce((sum, row) => sum + (row.unrealizedPnl || 0), 0);
  const netLiquidation = account.cash + grossMarketValue;
  const availableCash = account.cash - reservedCash(account);
  for (const holding of holdings) holding.weight = grossMarketValue ? (holding.marketValue / grossMarketValue) * 100 : 0;
  const timestamp = nowIso(now);
  const latestQuoteTimestamp = holdings.map((row) => row.quoteTimestamp).filter(Boolean).sort().at(-1) || account.updatedAt;
  return {
    paper: true,
    cash: account.cash,
    availableCash,
    buyingPower: availableCash,
    excessLiquidity: availableCash,
    netLiquidation,
    margin: 0,
    connected: true,
    managedAccounts: ['PAPER'],
    selectedAccount: 'PAPER',
    accountType: 'SIMULATED CASH',
    metrics: { USD: {
      NetLiquidation: netLiquidation,
      TotalCashValue: account.cash,
      BuyingPower: availableCash,
      ExcessLiquidity: availableCash,
      InitMarginReq: 0,
      MaintMarginReq: 0,
      GrossPositionValue: grossMarketValue,
      RealizedPnL: account.realizedPnl,
    } },
    summaryReady: true,
    summaryError: null,
    summaryUpdatedAt: account.updatedAt || timestamp,
    holdingsReady: true,
    holdingsError: null,
    holdingsUpdatedAt: latestQuoteTimestamp,
    grossMarketValue,
    unrealizedPnl,
    realizedPnl: account.realizedPnl,
    baseCurrency: 'USD',
    holdings,
  };
}

