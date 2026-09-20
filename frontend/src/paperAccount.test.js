/**
 * Regression tests for the browser-local Paper Account engine (`paperAccount.js`,
 * added by the paper-account implementation). Behavior under test is the agreed
 * acceptance list in the paper-account handoff; nothing here reads production
 * source text.
 *
 * Engine operations under test:
 *   createPaperAccount, submitPaperOrder, modifyPaperOrder,
 *   cancelPaperOrder, applyPaperQuote, expirePaperOrders, and overview readers.
 *
 * Storage: loadPaperAccount(storage, now), savePaperAccount(account, storage),
 * both keyed by PAPER_ACCOUNT_KEY and failing with PaperAccountError.
 *
 * Order payload mirrors `/api/orders`: { symbol, action, quantity, price, tif,
 * bracket: { takeProfitPrice, stopLossPrice } }.
 */
import { describe, expect, it } from 'vitest'
import * as engine from './paperAccount'
import {
  DEFAULT_PAPER_CASH,
  PAPER_ACCOUNT_KEY,
  PaperAccountError,
  loadPaperAccount,
  savePaperAccount,
} from './paperAccount'

const first = (value, keys) => {
  for (const key of keys) {
    const candidate = value?.[key]
    if (candidate !== undefined && candidate !== null) return candidate
  }
  return undefined
}

const CASH_KEYS = ['cash', 'cashBalance', 'totalCashValue', 'availableCash']
const BUYING_POWER_KEYS = ['buyingPower', 'excessLiquidity']

const applied = (account, result) => (result?.account ?? result) || account
const createAccount = options => engine.createPaperAccount(options?.startingCash)
const resetAccount = (_account, options) => engine.createPaperAccount(options?.startingCash)
const submitOrder = (account, order) => applied(account, engine.submitPaperOrder(account, order))
const modifyOrder = (account, id, changes) => engine.modifyPaperOrder(account, id, changes)
const cancelOrder = (account, id) => engine.cancelPaperOrder(account, id)
const applyQuote = (account, quote) => engine.applyPaperQuote(account, quote.symbol, quote.price)
const expireDayOrders = (account, now) => engine.expirePaperOrders(account, now)
const overview = account => engine.buildPaperOverview(account)
const openOrders = account => engine.getOpenPaperOrders(account)
const orderHistory = account => engine.getPaperOrderHistory(account)

const number = (value, keys) => Number(first(value, keys))
const cashOf = account => number(overview(account), CASH_KEYS)
const buyingPowerOf = account => number(overview(account), BUYING_POWER_KEYS)

const positionsOf = account => {
  const source =
    first(overview(account), ['positions', 'holdings']) ??
    first(account, ['positions', 'holdings']) ??
    []
  return Array.isArray(source) ? source : Object.values(source)
}
const positionFor = (account, symbol) =>
  positionsOf(account).find(
    position => (first(position, ['symbol']) ?? first(position, ['contract'])?.symbol) === symbol,
  )
const quantityOf = position =>
  Number(first(position ?? {}, ['quantity', 'shares', 'position', 'positionSize']) ?? 0)
const costPerShare = position => {
  const average = first(position ?? {}, ['averageCost', 'avgCost', 'averagePrice'])
  if (average !== undefined) return Number(average)
  const quantity = quantityOf(position)
  return quantity ? Number(first(position ?? {}, ['costBasis', 'totalCost'])) / quantity : NaN
}

const orderId = order => first(order, ['id', 'orderId', 'orderRef'])
const limitOf = order => Number(first(order, ['price', 'limitPrice']))
const filledOf = order => Number(first(order, ['filled', 'filledQuantity', 'filledQty']) ?? 0)
const tifOf = order => String(first(order, ['tif', 'timeInForce']) ?? '')
const realizedOf = account =>
  Number(first(overview(account), ['realizedPnl', 'realizedPL', 'totalRealizedPnl']) ?? first(account, ['realizedPnl', 'realizedPL']))
const unrealizedOf = account => {
  const direct = first(overview(account), ['unrealizedPnl', 'unrealizedPL', 'totalUnrealizedPnl'])
  if (direct !== undefined) return Number(direct)
  return Number(
    first(positionFor(account, 'AAA') ?? {}, ['unrealizedPnl', 'unrealizedPL', 'unrealizedProfitLoss']) ?? 0,
  )
}

const observable = account =>
  JSON.stringify({
    overview: overview(account),
    open: openOrders(account),
    history: orderHistory(account),
  })

// Invalid or refused input may throw or return the account unchanged.
const expectRejected = (account, action) => {
  const before = observable(account)
  let next
  try {
    next = action()
  } catch {
    return
  }
  if (next === account) return
  expect(observable(next)).toBe(before)
}

const buyAt = (account, symbol, quantity, price, tif = 'DAY') =>
  applyQuote(submitOrder(account, { symbol, action: 'BUY', quantity, price, tif }), {
    symbol,
    price,
  })

describe('paper account funding', () => {
  it('starts with $100,000 of cash, no positions, and no margin', () => {
    const account = createAccount()
    expect(cashOf(account)).toBe(100000)
    expect(number(overview(account), ['netLiquidation', 'netLiquidationValue'])).toBe(100000)
    expect(buyingPowerOf(account)).toBe(100000)
    expect(Number(first(overview(account), ['margin', 'initMarginReq', 'initialMargin']) ?? 0)).toBe(0)
    expect(positionsOf(account)).toEqual([])
    expect(openOrders(account)).toEqual([])
  })

  it('resets only to a positive starting cash balance', () => {
    const reset = resetAccount(createAccount(), { startingCash: 2500 })
    expect(cashOf(reset)).toBe(2500)
    expect(cashOf(createAccount({ startingCash: 5000 }))).toBe(5000)
    for (const startingCash of [0, -100, NaN]) {
      expectRejected(reset, () => resetAccount(reset, { startingCash }))
      expect(cashOf(reset)).toBe(2500)
    }
  })
})

describe('paper order validation and reservation', () => {
  it('accepts only whole positive share quantities', () => {
    const account = createAccount()
    for (const quantity of [1.5, 0, -3, 2 ** 53]) {
      expectRejected(account, () =>
        submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity, price: 100, tif: 'DAY' }),
      )
    }
    expect(openOrders(account)).toEqual([])
  })

  it('reserves cash for pending buy orders and refuses leverage', () => {
    let account = createAccount({ startingCash: 10000 })
    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 50, price: 100, tif: 'GTC' })
    expect(buyingPowerOf(account)).toBe(5000)
    expectRejected(account, () =>
      submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 51, price: 100, tif: 'GTC' }),
    )
    expectRejected(account, () =>
      submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 100, price: 100, tif: 'GTC' }),
    )
    expect(openOrders(account)).toHaveLength(1)
    expect(cashOf(account)).toBe(10000)
  })

  it('lets a DAY order sell expire at the local day boundary but keeps GTC', () => {
    let account = createAccount()
    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 1, price: 50, tif: 'DAY' })
    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 1, price: 50, tif: 'GTC' })
    expect(openOrders(account)).toHaveLength(2)

    const today = new Date()
    account = expireDayOrders(
      account,
      new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
    )
    expect(openOrders(account)).toHaveLength(2)

    account = expireDayOrders(
      account,
      new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 0, 0, 1),
    )
    const stillOpen = openOrders(account)
    expect(stillOpen).toHaveLength(1)
    expect(tifOf(stillOpen[0])).toBe('GTC')
    expect(buyingPowerOf(account)).toBe(100000 - 50)
  })
})

describe('paper fills', () => {
  it('fills a buy limit at min(quote, limit) and leaves it pending above the limit', () => {
    let account = createAccount()
    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 10, price: 100, tif: 'DAY' })
    account = applyQuote(account, { symbol: 'AAA', price: 105 })
    expect(openOrders(account)).toHaveLength(1)
    expect(filledOf(openOrders(account)[0])).toBe(0)

    account = applyQuote(account, { symbol: 'AAA', price: 95 })
    expect(openOrders(account)).toHaveLength(0)
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(10)
    expect(costPerShare(positionFor(account, 'AAA'))).toBe(95)
    expect(cashOf(account)).toBe(100000 - 950)

    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 2, price: 95, tif: 'DAY' })
    account = applyQuote(account, { symbol: 'AAA', price: 95 })
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(12)
    expect(costPerShare(positionFor(account, 'AAA'))).toBe(95)
  })

  it('fills a sell limit at max(quote, limit) using reserved shares only', () => {
    let account = createAccount()
    account = buyAt(account, 'AAA', 10, 100)
    expectRejected(account, () =>
      submitOrder(account, { symbol: 'AAA', action: 'SELL', quantity: 11, price: 120, tif: 'DAY' }),
    )

    account = submitOrder(account, { symbol: 'AAA', action: 'SELL', quantity: 10, price: 120, tif: 'GTC' })
    expectRejected(account, () =>
      submitOrder(account, { symbol: 'AAA', action: 'SELL', quantity: 1, price: 120, tif: 'GTC' }),
    )

    account = applyQuote(account, { symbol: 'AAA', price: 130 })
    expect(openOrders(account)).toHaveLength(0)
    expect(positionsOf(account)).toEqual([])
    expect(cashOf(account)).toBe(100000 + 10 * 30)
  })

  it('triggers sell stops at or below the stop and buy stops at or above it, filling at the quote', () => {
    let account = createAccount()
    account = buyAt(account, 'AAA', 10, 100)
    account = submitOrder(account, {
      symbol: 'AAA',
      action: 'SELL',
      quantity: 10,
      tif: 'GTC',
      orderType: 'STP',
      stopPrice: 90,
      price: 90,
    })
    account = applyQuote(account, { symbol: 'AAA', price: 95 })
    expect(openOrders(account)).toHaveLength(1)

    account = applyQuote(account, { symbol: 'AAA', price: 88 })
    expect(openOrders(account)).toHaveLength(0)
    expect(positionsOf(account)).toEqual([])
    expect(cashOf(account)).toBe(100000 - 1000 + 880)

    let stopBuy = createAccount({ startingCash: 5000 })
    stopBuy = submitOrder(stopBuy, {
      symbol: 'BBB',
      action: 'BUY',
      quantity: 5,
      tif: 'GTC',
      orderType: 'STP',
      stopPrice: 60,
      price: 60,
    })
    stopBuy = applyQuote(stopBuy, { symbol: 'BBB', price: 55 })
    expect(openOrders(stopBuy)).toHaveLength(1)

    stopBuy = applyQuote(stopBuy, { symbol: 'BBB', price: 62 })
    expect(openOrders(stopBuy)).toHaveLength(0)
    expect(cashOf(stopBuy)).toBe(5000 - 5 * 62)
  })

  it('fills IOC and FOK immediately when marketable and cancels them otherwise', () => {
    let account = createAccount()
    account = applyQuote(account, { symbol: 'AAA', price: 100 })
    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 2, price: 105, tif: 'IOC' })
    expect(cashOf(account)).toBe(100000 - 200)
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(2)
    expect(openOrders(account)).toEqual([])

    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 3, price: 100, tif: 'FOK' })
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(5)

    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 1, price: 90, tif: 'IOC' })
    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 1, price: 90, tif: 'FOK' })
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(5)
    expect(cashOf(account)).toBe(100000 - 500)
  })

  it('cancels IOC and FOK without a usable quote while DAY and GTC stay pending', () => {
    let account = createAccount()
    for (const tif of ['DAY', 'GTC']) {
      account = submitOrder(account, { symbol: 'BBB', action: 'BUY', quantity: 1, price: 90, tif })
    }
    for (const tif of ['IOC', 'FOK']) {
      account = submitOrder(account, { symbol: 'BBB', action: 'BUY', quantity: 1, price: 90, tif })
    }
    expect(openOrders(account).map(tifOf).sort()).toEqual(['DAY', 'GTC'])
    expect(positionsOf(account)).toEqual([])
  })
})

describe('paper brackets', () => {
  const bracketBuy = account =>
    submitOrder(account, {
      symbol: 'AAA',
      action: 'BUY',
      quantity: 10,
      price: 100,
      tif: 'GTC',
      bracket: { takeProfitPrice: 110, stopLossPrice: 90 },
    })

  it('does not fill bracket children before the parent fills', () => {
    let account = bracketBuy(createAccount())
    expect(openOrders(account)).toHaveLength(3)

    account = applyQuote(account, { symbol: 'AAA', price: 110 })
    expect(positionsOf(account)).toEqual([])
    expect(cashOf(account)).toBe(100000)

    account = applyQuote(account, { symbol: 'AAA', price: 100 })
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(10)
    expect(cashOf(account)).toBe(99000)

    account = applyQuote(account, { symbol: 'AAA', price: 110 })
    expect(positionsOf(account)).toEqual([])
    expect(cashOf(account)).toBe(100100)
  })

  it('cancels the remaining bracket orders when any bracket order is cancelled', () => {
    let account = bracketBuy(createAccount())
    const [anyBracketOrder] = openOrders(account)
    account = cancelOrder(account, orderId(anyBracketOrder))
    expect(openOrders(account)).toEqual([])
    expect(orderHistory(account)).toHaveLength(3)
  })

  it('cancels the sibling when one activated bracket child is cancelled', () => {
    let account = bracketBuy(createAccount())
    account = applyQuote(account, { symbol: 'AAA', price: 100 })
    const children = openOrders(account)
    expect(children).toHaveLength(2)

    account = cancelOrder(account, orderId(children[0]))
    expect(openOrders(account)).toEqual([])
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(10)
  })

  it('rejects IOC and FOK brackets instead of leaving immediate children open', () => {
    for (const tif of ['IOC', 'FOK']) {
      const account = createAccount()
      expectRejected(account, () => submitOrder(account, {
        symbol: 'AAA', action: 'BUY', quantity: 1, price: 100, tif,
        bracket: { takeProfitPrice: 110, stopLossPrice: 90 },
      }))
      expect(openOrders(account)).toEqual([])
    }
  })

  it('rejects sell brackets', () => {
    const account = buyAt(createAccount(), 'AAA', 10, 100)
    expectRejected(account, () =>
      submitOrder(account, {
        symbol: 'AAA',
        action: 'SELL',
        quantity: 10,
        price: 110,
        tif: 'GTC',
        bracket: { takeProfitPrice: 120, stopLossPrice: 100 },
      }),
    )
    expect(openOrders(account)).toEqual([])
  })
})

describe('paper modifications and accounting', () => {
  it('allows price-only modification and rejects quantity changes', () => {
    let account = createAccount()
    account = submitOrder(account, { symbol: 'AAA', action: 'BUY', quantity: 10, price: 100, tif: 'GTC' })
    expect(buyingPowerOf(account)).toBe(99000)

    const id = orderId(openOrders(account)[0])
    account = modifyOrder(account, id, { price: 90, limitPrice: 90 })
    expect(limitOf(openOrders(account)[0])).toBe(90)
    expect(buyingPowerOf(account)).toBe(99100)

    expectRejected(account, () => modifyOrder(account, id, { quantity: 5 }))
    expect(openOrders(account)).toHaveLength(1)
    expect(filledOf(openOrders(account)[0])).toBe(0)
  })

  it('averages cost basis and reports realized and unrealized P&L with zero fees', () => {
    let account = createAccount()
    account = buyAt(account, 'AAA', 10, 100)
    account = buyAt(account, 'AAA', 10, 120)
    expect(quantityOf(positionFor(account, 'AAA'))).toBe(20)
    expect(costPerShare(positionFor(account, 'AAA'))).toBe(110)

    account = applyQuote(
      submitOrder(account, { symbol: 'AAA', action: 'SELL', quantity: 5, price: 130, tif: 'DAY' }),
      { symbol: 'AAA', price: 130 },
    )
    expect(cashOf(account)).toBe(100000 - 1000 - 1200 + 650)
    expect(realizedOf(account)).toBeCloseTo(100)
    expect(unrealizedOf(account)).toBeCloseTo(300)
    // 15 shares marked at 130 plus realized 100 on the 5 sold shares, zero fees.
    expect(number(overview(account), ['netLiquidation', 'netLiquidationValue'])).toBeCloseTo(100400)
  })

  it('retains a filled bracket parent while its exits remain active', () => {
    let account = submitOrder(createAccount(), {
      symbol: 'AAA', action: 'BUY', quantity: 1, price: 100, tif: 'GTC',
      bracket: { takeProfitPrice: 110, stopLossPrice: 90 },
    })
    account = applyQuote(account, { symbol: 'AAA', price: 100 })
    for (let index = 0; index < 501; index += 1) {
      account = submitOrder(account, { symbol: 'BBB', action: 'BUY', quantity: 1, price: 1, tif: 'GTC' })
      const pending = openOrders(account).find(order => order.symbol === 'BBB')
      account = cancelOrder(account, orderId(pending))
    }
    expect(orderHistory(account).some(order => order.bracketRole === 'parent')).toBe(true)
    expect(openOrders(account).filter(order => order.parentId)).toHaveLength(2)
  })

  it('retains only the latest 500 terminal orders', () => {
    let account = createAccount()
    for (let index = 0; index < 505; index += 1) {
      account = submitOrder(account, {
        symbol: 'AAA',
        action: 'BUY',
        quantity: 1,
        price: 1,
        tif: 'GTC',
      })
      const [pending] = openOrders(account)
      account = cancelOrder(account, orderId(pending))
    }
    expect(openOrders(account)).toEqual([])
    expect(orderHistory(account)).toHaveLength(500)
  })
})

describe('paper account storage', () => {
  const memoryStorage = (initial = {}) => {
    const data = new Map(Object.entries(initial))
    return {
      getItem: key => (data.has(key) ? data.get(key) : null),
      setItem: (key, value) => data.set(key, String(value)),
    }
  }
  const unavailableStorage = () => ({
    getItem: () => { throw new Error('storage denied') },
    setItem: () => { throw new Error('storage denied') },
  })

  it('creates and persists a default account when nothing is stored', () => {
    const storage = memoryStorage()
    const account = loadPaperAccount(storage)
    expect(account.cash).toBe(DEFAULT_PAPER_CASH)
    expect(JSON.parse(storage.getItem(PAPER_ACCOUNT_KEY))).toEqual(account)
  })

  it('rejects corrupt JSON and invalid schemas instead of returning an account', () => {
    const corrupt = [
      '{not json',
      JSON.stringify({ version: 1, cash: 'nope' }),
      JSON.stringify({ ...createAccount(), orders: [{ id: 'a' }] }),
      JSON.stringify({ ...createAccount(), holdings: { AAA: { symbol: 'AAA', quantity: 1.5, averageCost: 10 } } }),
    ]
    for (const raw of corrupt) {
      const storage = memoryStorage({ [PAPER_ACCOUNT_KEY]: raw })
      expect(() => loadPaperAccount(storage)).toThrow(PaperAccountError)
      expect(storage.getItem(PAPER_ACCOUNT_KEY)).toBe(raw)
    }
  })

  it('blocks account creation when storage cannot be read or written', () => {
    expect(() => loadPaperAccount(unavailableStorage())).toThrow(PaperAccountError)

    const full = memoryStorage()
    full.setItem = () => { throw new Error('quota exceeded') }
    expect(() => loadPaperAccount(full)).toThrow(PaperAccountError)
  })

  it('refuses to save an invalid or unwritable account', () => {
    const storage = memoryStorage()
    expect(() => savePaperAccount({ ...createAccount(), cash: 'nope' }, storage)).toThrow(PaperAccountError)
    expect(storage.getItem(PAPER_ACCOUNT_KEY)).toBeNull()

    const full = memoryStorage()
    full.setItem = () => { throw new Error('quota exceeded') }
    expect(() => savePaperAccount(createAccount(), full)).toThrow(PaperAccountError)
  })
})
