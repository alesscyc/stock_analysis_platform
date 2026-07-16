'use strict';

const DRAFT_FIELDS = new Set([
  'symbol',
  'action',
  'quantity',
  'orderType',
  'limitPrice',
  'stopPrice',
]);

const POSITION_FIELDS = [
  'symbol',
  'type',
  'quantity',
  'avgCost',
  'costBasis',
  'currency',
  'exchange',
  'secType',
  'marketPrice',
  'marketValue',
  'unrealizedPnL',
  'realizedPnL',
  'dailyPnL',
  'cashBalance',
  'totalCashValue',
  'settledCash',
  'accruedCash',
  'netLiquidation',
  'buyingPower',
  'availableFunds',
  'excessLiquidity',
];

const PENDING_ORDER_FIELDS = [
  'symbol',
  'action',
  'orderType',
  'quantity',
  'limitPrice',
  'status',
  'filled',
  'remaining',
  'tif',
  'bracketRole',
];

function sanitizeRows(rows, fields) {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];

    const sanitized = {};
    for (const field of fields) {
      const value = row[field];
      if (value == null || (typeof value === 'number' && !Number.isFinite(value))) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
      sanitized[field] = typeof value === 'string' ? value.slice(0, 100) : value;
    }
    return Object.keys(sanitized).length > 0 ? [sanitized] : [];
  });
}

function buildChatIbContext(portfolioRows, pendingOrders) {
  return {
    positions: sanitizeRows(portfolioRows, POSITION_FIELDS),
    pendingOrders: sanitizeRows(pendingOrders, PENDING_ORDER_FIELDS),
  };
}

function normalizeDraftOrder(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  if (Object.keys(draft).some((field) => !DRAFT_FIELDS.has(field))) return null;
  if (typeof draft.symbol !== 'string'
    || typeof draft.action !== 'string'
    || typeof draft.orderType !== 'string'
    || typeof draft.quantity !== 'number'
    || typeof draft.limitPrice !== 'number') return null;

  const symbol = draft.symbol.trim().toUpperCase();
  const action = draft.action.trim().toUpperCase();
  const quantity = draft.quantity;
  const orderType = draft.orderType.trim().toUpperCase();
  const limitPrice = draft.limitPrice;

  if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)
    || !['BUY', 'SELL'].includes(action)
    || !Number.isSafeInteger(quantity)
    || quantity <= 0
    || orderType !== 'LMT'
    || !Number.isFinite(limitPrice)
    || limitPrice <= 0
    || draft.stopPrice != null) return null;

  return {
    symbol,
    action,
    quantity,
    orderType,
    limitPrice,
    stopPrice: null,
  };
}

function parseChatResponse(content) {
  const answerOnly = typeof content === 'string' ? content.trim() : '';
  if (!answerOnly) return null;

  try {
    const parsed = JSON.parse(answerOnly);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
      return { answer: answerOnly, draftOrder: null };
    }
    return {
      answer: parsed.answer.trim(),
      draftOrder: normalizeDraftOrder(parsed.draftOrder),
    };
  } catch {
    return { answer: answerOnly, draftOrder: null };
  }
}

module.exports = {
  buildChatIbContext,
  normalizeDraftOrder,
  parseChatResponse,
};
