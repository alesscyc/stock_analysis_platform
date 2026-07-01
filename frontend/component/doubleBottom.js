/**
 * @typedef {Object} PivotPoint
 * @property {number} index
 * @property {string|number} time
 * @property {number} price
 * @property {'high'|'low'} type
 */

/**
 * @typedef {Object} Candle
 * @property {string|number} time
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */

/**
 * @typedef {Object} DoubleBottomPattern
 * @property {string} id
 * @property {PivotPoint} h0
 * @property {PivotPoint} l1
 * @property {PivotPoint} h1
 * @property {PivotPoint} l2
 * @property {Candle} [breakout]
 * @property {'pending'|'confirmed'} status
 */

/**
 * @typedef {Object} DoubleBottomOptions
 * @property {number} [leftBars]
 * @property {number} [rightBars]
 * @property {number} [bottomTolerance]
 * @property {number} [necklineThreshold]
 * @property {number} [minNecklineDecline]
 * @property {number} [minBarsBetweenBottoms]
 * @property {number} [maxBarsBetweenBottoms]
 * @property {boolean} [requireBreakoutVolume]
 * @property {number} [breakoutVolumeMultiplier]
 * @property {number} [avgVolumePeriod]
 */

export const DEFAULT_DOUBLE_BOTTOM_OPTIONS = {
  leftBars: 3,
  rightBars: 3,
  bottomTolerance: 0.03,
  necklineThreshold: 1.03,
  minNecklineDecline: 0.02,
  minBarsBetweenBottoms: 10,
  maxBarsBetweenBottoms: 80,
  requireBreakoutVolume: false,
  breakoutVolumeMultiplier: 1.2,
  avgVolumePeriod: 20,
}

/**
 * @param {Candle[]} data
 * @param {number} [leftBars]
 * @param {number} [rightBars]
 * @returns {PivotPoint[]}
 */
export function findPivotHighs(data, leftBars = 3, rightBars = 3) {
  if (!data?.length) return []

  const pivots = []
  for (let i = leftBars; i < data.length - rightBars; i++) {
    const high = data[i].high
    let isPivot = true

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue
      if (data[j].high >= high) {
        isPivot = false
        break
      }
    }

    if (isPivot) {
      pivots.push({
        index: i,
        time: data[i].time,
        price: high,
        type: 'high',
      })
    }
  }

  return pivots
}

/**
 * @param {Candle[]} data
 * @param {number} [leftBars]
 * @param {number} [rightBars]
 * @returns {PivotPoint[]}
 */
export function findPivotLows(data, leftBars = 3, rightBars = 3) {
  if (!data?.length) return []

  const pivots = []
  for (let i = leftBars; i < data.length - rightBars; i++) {
    const low = data[i].low
    let isPivot = true

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue
      if (data[j].low <= low) {
        isPivot = false
        break
      }
    }

    if (isPivot) {
      pivots.push({
        index: i,
        time: data[i].time,
        price: low,
        type: 'low',
      })
    }
  }

  return pivots
}

function avgVolumeBefore(data, index, period) {
  if (index < period) return null
  let sum = 0
  for (let i = index - period; i < index; i++) {
    sum += data[i].volume ?? 0
  }
  return sum / period
}

function findBreakout(data, l2Index, necklinePrice, opts) {
  for (let i = l2Index + 1; i < data.length; i++) {
    const candle = data[i]
    if (candle.close <= necklinePrice) continue

    if (opts.requireBreakoutVolume) {
      const avgVol = avgVolumeBefore(data, i, opts.avgVolumePeriod)
      const volume = candle.volume ?? 0
      if (avgVol === null || volume <= avgVol * opts.breakoutVolumeMultiplier) continue
    }

    return candle
  }

  return null
}

/** ponytail: 0.5% wick slack only — not bottomTolerance (3% L1≈L2 match) */
const INTERMEDIATE_WICK_SLACK = 0.005

/** True when any bar strictly between two bottoms dips below their floor. */
function hasLowerLowBetween(data, l1Index, l2Index, floorPrice) {
  const minAllowed = floorPrice * (1 - INTERMEDIATE_WICK_SLACK)
  for (let i = l1Index + 1; i < l2Index; i++) {
    if (data[i].low < minAllowed) return true
  }
  return false
}

/** True when price breaks below the first bottom before the neckline peak. */
function breaksFirstBottomBeforeNeckline(data, l1Index, h1Index, l1Price) {
  const minAllowed = l1Price * (1 - INTERMEDIATE_WICK_SLACK)
  for (let i = l1Index + 1; i < h1Index; i++) {
    if (data[i].low < minAllowed) return true
  }
  return false
}

function patternQuality(p) {
  const bottomDiff = Math.abs(p.l2.price - p.l1.price) / p.l1.price
  const span = p.l2.index - p.l1.index
  return bottomDiff + span / 1000
}

function dedupeOverlapping(patterns) {
  const ranked = [...patterns].sort((a, b) => patternQuality(a) - patternQuality(b))
  const kept = []

  for (const p of ranked) {
    const overlaps = kept.some(k => p.l1.index <= k.l2.index && p.l2.index >= k.l1.index)
    if (!overlaps) kept.push(p)
  }

  return kept.sort((a, b) => a.l1.index - b.l1.index)
}

/**
 * @param {Candle[]} data
 * @param {DoubleBottomOptions} [options]
 * @returns {DoubleBottomPattern[]}
 */
export function detectDoubleBottoms(data, options = {}) {
  if (!data?.length) return []

  const opts = { ...DEFAULT_DOUBLE_BOTTOM_OPTIONS, ...options }
  const pivotHighs = findPivotHighs(data, opts.leftBars, opts.rightBars)
  const pivotLows = findPivotLows(data, opts.leftBars, opts.rightBars)
  const patterns = []
  const seenIds = new Set()

  for (const l1 of pivotLows) {
    const l2Candidates = pivotLows.filter(l => {
      if (l.index <= l1.index) return false
      const barsBetween = l.index - l1.index
      if (barsBetween < opts.minBarsBetweenBottoms || barsBetween > opts.maxBarsBetweenBottoms) return false
      const bottomDiff = Math.abs(l.price - l1.price) / l1.price
      return bottomDiff <= opts.bottomTolerance
    })
    if (!l2Candidates.length) continue

    const l2 = l2Candidates.reduce((best, l) => {
      const bestDiff = Math.abs(best.price - l1.price)
      const candDiff = Math.abs(l.price - l1.price)
      if (candDiff !== bestDiff) return candDiff < bestDiff ? l : best
      return l.index > best.index ? l : best
    })

    const floorPrice = Math.min(l1.price, l2.price)
    if (hasLowerLowBetween(data, l1.index, l2.index, floorPrice)) continue

    const betweenHighs = pivotHighs.filter(h => h.index > l1.index && h.index < l2.index)
    if (!betweenHighs.length) continue
    const h1 = betweenHighs.reduce((best, h) => (h.price > best.price ? h : best))

    if (breaksFirstBottomBeforeNeckline(data, l1.index, h1.index, l1.price)) continue

    const h0Candidates = pivotHighs.filter(h => h.index < l1.index)
    if (!h0Candidates.length) continue
    const h0 = h0Candidates[h0Candidates.length - 1]

    const id = `${h0.index}-${l1.index}-${h1.index}-${l2.index}`
    if (seenIds.has(id)) continue

    if (h1.price >= h0.price) continue

    const necklineDecline = (h0.price - h1.price) / h0.price
    if (necklineDecline < opts.minNecklineDecline) continue

    const maxBottom = Math.max(l1.price, l2.price)
    if (h1.price <= maxBottom * opts.necklineThreshold) continue

    seenIds.add(id)
    const breakout = findBreakout(data, l2.index, h1.price, opts)

    patterns.push({
      id,
      h0,
      l1,
      h1,
      l2,
      breakout: breakout ?? undefined,
      status: breakout ? 'confirmed' : 'pending',
    })
  }

  return dedupeOverlapping(patterns)
}
