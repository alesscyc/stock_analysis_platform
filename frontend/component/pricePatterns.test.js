import { describe, expect, it, vi } from 'vitest'
import {
  detectDoubleBottoms,
  detectDoubleTops,
  detectHeadShoulders,
  detectInverseHeadShoulders,
  detectPricePatterns,
  dedupeOverlappingPatterns,
} from './pricePatterns'
import { createPricePatternPrimitive } from './pricePatternChart'

const candle = (time, high, low, close = high - 1) => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 100,
})

const options = {
  leftBars: 1,
  rightBars: 1,
  minBarsBetweenBottoms: 4,
  maxBarsBetweenBottoms: 8,
}

const downtrend = [
  candle(0, 110, 100),
  candle(1, 135, 125),
  candle(2, 112, 108),
  candle(3, 125, 118),
  candle(4, 112, 104),
  candle(5, 108, 100),
  candle(6, 112, 104),
  candle(7, 120, 110),
  candle(8, 114, 106),
  candle(9, 111, 103),
  candle(10, 108, 101),
  candle(11, 114, 105),
  candle(12, 121, 111, 121),
  candle(13, 119, 112),
]

const mirror = data => data.map(bar => ({
  ...bar,
  open: 10000 / bar.open,
  high: 10000 / bar.low,
  low: 10000 / bar.high,
  close: 10000 / bar.close,
}))

const hsOptions = {
  leftBars: 1,
  rightBars: 1,
  minBarsLeg: 3,
  maxBarsLeg: 20,
  minHeadClearance: 0.03,
  shoulderTolerance: 0.05,
}

/** Classic H&S: LS@1 → N1@3 → Head@5 → N2@7 → RS@9, breakout@12 */
const headShoulders = [
  candle(0, 100, 90, 95),
  candle(1, 120, 105, 115),
  candle(2, 110, 100, 105),
  candle(3, 105, 85, 90),
  candle(4, 115, 95, 110),
  candle(5, 145, 125, 140),
  candle(6, 130, 110, 120),
  candle(7, 115, 88, 95),
  candle(8, 118, 100, 112),
  candle(9, 122, 108, 118),
  candle(10, 112, 100, 105),
  candle(11, 108, 95, 100),
  candle(12, 100, 80, 82),
]

describe('double bottom', () => {
  it('requires a downtrend before the first bottom', () => {
    const uptrend = downtrend.map((bar, index) => {
      if (index === 1) return { ...bar, high: 115 }
      if (index === 2) return { ...bar, low: 90 }
      return bar
    })

    expect(detectDoubleBottoms(uptrend, options)).toEqual([])
    expect(detectDoubleBottoms(downtrend, options)).toMatchObject([
      { nameKey: 'patternDoubleBottom' },
    ])
  })

  it('keeps a failed pattern with its invalidating candle', () => {
    const failed = downtrend.map(bar => bar.time === 12
      ? candle(12, 105, 95, 99)
      : bar)
    const [pattern] = detectDoubleBottoms(failed, options)

    expect(pattern.status).toBe('failed')
    expect(pattern.invalidated.time).toBe(12)
  })
})

describe('double top', () => {
  const topOptions = {
    leftBars: 1,
    rightBars: 1,
    minBarsBetweenTops: 4,
    maxBarsBetweenTops: 8,
  }

  it('mirrors the double-bottom rules and confirms below the neckline', () => {
    const [pattern] = detectDoubleTops(mirror(downtrend), topOptions)

    expect(pattern.type).toBe('double-top')
    expect(pattern.status).toBe('confirmed')
    expect(pattern.breakout.time).toBe(12)
    expect(pattern.lines).toHaveLength(2)
    expect(pattern.nameKey).toBe('patternDoubleTop')
  })

  it('keeps a failed pattern with its invalidating candle', () => {
    const failedBottom = downtrend.map(bar => bar.time === 12
      ? candle(12, 105, 95, 99)
      : bar)
    const [pattern] = detectDoubleTops(mirror(failedBottom), topOptions)

    expect(pattern.status).toBe('failed')
    expect(pattern.invalidated.time).toBe(12)
  })
})

describe('head and shoulders', () => {
  it('confirms classic pattern on sloping neckline break', () => {
    const [pattern] = detectHeadShoulders(headShoulders, hsOptions)

    expect(pattern).toMatchObject({
      type: 'head-shoulders',
      nameKey: 'patternHeadShoulders',
      status: 'confirmed',
      color: '#ef5350',
    })
    expect(pattern.breakout.time).toBe(12)
    expect(pattern.lines).toHaveLength(2)
    expect(pattern.lines[0].points).toHaveLength(5)
  })

  it('fails when close breaks above the head before neckline', () => {
    const failed = headShoulders.map(bar => bar.time === 12
      ? candle(12, 150, 140, 148)
      : bar)
    const [pattern] = detectHeadShoulders(failed, hsOptions)

    expect(pattern.status).toBe('failed')
    expect(pattern.invalidated.time).toBe(12)
  })

  it('stays pending when neither breakout nor head fail occurs', () => {
    const pending = headShoulders.slice(0, 12)
    const [pattern] = detectHeadShoulders(pending, hsOptions)

    expect(pattern.status).toBe('pending')
    expect(pattern.breakout).toBeUndefined()
    expect(pattern.invalidated).toBeUndefined()
  })

  it('rejects when neckline troughs differ by more than 5%', () => {
    const skewed = headShoulders.map(bar => bar.time === 7
      ? candle(7, 115, 70, 80)
      : bar)
    expect(detectHeadShoulders(skewed, hsOptions)).toEqual([])
  })

  it('rejects when right leg is much longer than left leg', () => {
    // Compact left (LS@1→Head@5), stretched right to RS@17 — ratio 3 > 2.
    // Mid highs stay below shoulderTolerance of LS so no early RS sneak-in.
    const stretched = [
      candle(0, 100, 90, 95),
      candle(1, 120, 105, 115),
      candle(2, 110, 100, 105),
      candle(3, 105, 85, 90),
      candle(4, 115, 95, 110),
      candle(5, 145, 125, 140),
      candle(6, 130, 110, 120),
      candle(7, 115, 88, 95),
      candle(8, 108, 100, 104),
      candle(9, 110, 98, 102),
      candle(10, 109, 99, 103),
      candle(11, 111, 97, 101),
      candle(12, 110, 98, 102),
      candle(13, 112, 100, 104),
      candle(14, 111, 99, 103),
      candle(15, 113, 101, 106),
      candle(16, 112, 100, 105),
      candle(17, 122, 108, 118),
      candle(18, 112, 100, 105),
      candle(19, 100, 80, 82),
    ]
    expect(detectHeadShoulders(stretched, { ...hsOptions, maxBarsLeg: 20, maxLegAsymmetry: 2 })).toEqual([])
  })

  it('does not use a far left peak that skips an intervening shoulder', () => {
    // Far peak@1, real shoulder@5, N1@7, Head@9, N2@11, RS@13
    const skipped = [
      candle(0, 100, 90, 95),
      candle(1, 122, 105, 115),
      candle(2, 115, 100, 108),
      candle(3, 112, 98, 105),
      candle(4, 114, 100, 108),
      candle(5, 118, 105, 112),
      candle(6, 110, 95, 100),
      candle(7, 105, 85, 90),
      candle(8, 120, 100, 115),
      candle(9, 145, 125, 140),
      candle(10, 125, 105, 115),
      candle(11, 112, 88, 95),
      candle(12, 115, 100, 110),
      candle(13, 121, 108, 118),
      candle(14, 110, 100, 105),
      candle(15, 100, 80, 82),
    ]
    const patterns = detectHeadShoulders(skipped, hsOptions)
    expect(patterns.length).toBeGreaterThan(0)
    // LS must be adjacent shoulder@5 — never far peak@1 that skips it
    expect(patterns.every(p => p.lines[0].points[0].index === 5)).toBe(true)
  })

  it('mirrors rules for inverse head and shoulders', () => {
    const [pattern] = detectInverseHeadShoulders(mirror(headShoulders), hsOptions)

    expect(pattern.type).toBe('inverse-head-shoulders')
    expect(pattern.nameKey).toBe('patternInverseHeadShoulders')
    expect(pattern.status).toBe('confirmed')
    expect(pattern.breakout.time).toBe(12)
    expect(pattern.color).toBe('#26a69a')
  })
})

describe('price patterns', () => {
  it('keeps failed patterns as dotted overlays in the chart feed', () => {
    const failed = downtrend.map(bar => bar.time === 12
      ? candle(12, 105, 95, 99)
      : bar)

    expect(detectPricePatterns(failed, options)).toMatchObject([
      { type: 'double-bottom', status: 'failed' },
    ])
  })

  it('includes head and shoulders in the combined detector feed', () => {
    const patterns = detectPricePatterns(headShoulders, hsOptions)
    expect(patterns.some(p => p.type === 'head-shoulders' && p.status === 'confirmed')).toBe(true)
  })

  it('keeps one winner when any pattern types overlap in time', () => {
    const line = (start, end) => [{
      style: 'status',
      points: [{ index: start, time: start, price: 1 }, { index: end, time: end, price: 1 }],
    }]
    const kept = dedupeOverlappingPatterns([
      { type: 'head-shoulders', status: 'pending', startIndex: 0, lines: line(0, 10) },
      { type: 'inverse-head-shoulders', status: 'confirmed', startIndex: 5, lines: line(5, 15) },
      { type: 'double-bottom', status: 'confirmed', startIndex: 20, lines: line(20, 30) },
    ])

    expect(kept).toMatchObject([
      { type: 'inverse-head-shoulders', status: 'confirmed' },
      { type: 'double-bottom', status: 'confirmed' },
    ])
  })

  it('renders normalized geometry without knowing the pattern type', () => {
    const ctx = {
      beginPath: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      setLineDash: vi.fn(),
      measureText: vi.fn(() => ({ width: 20 })),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
    }
    const strokeColors = []
    Object.defineProperty(ctx, 'strokeStyle', { set: color => { strokeColors.push(color) } })
    const primitive = createPricePatternPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: time => time }) },
      series: { priceToCoordinate: price => price },
      requestUpdate: vi.fn(),
    })
    primitive.setLabelResolver(key => `translated:${key}`)
    const pattern = {
      nameKey: 'patternName',
      status: 'confirmed',
      color: '#fff',
      lines: [{
        points: [{ time: 1, price: 10 }, { time: 2, price: 20 }],
        style: 'status',
      }],
    }
    primitive.setPatterns([
      { ...pattern, type: 'double-top', status: 'failed', color: '#ef5350', pendingColor: '#bad' },
      { ...pattern, type: 'double-bottom', status: 'pending', color: '#26a69a', pendingColor: '#bad' },
    ])

    primitive.paneViews()[0].renderer().draw({
      useBitmapCoordinateSpace: draw => draw({
        context: ctx,
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
      }),
    })

    expect(ctx.moveTo).toHaveBeenCalledWith(1, 10)
    expect(ctx.lineTo).toHaveBeenCalledWith(2, 20)
    expect(ctx.fillRect).toHaveBeenCalledWith(1, 10, 1, 10)
    expect(ctx.fillText).toHaveBeenCalledWith('translated:patternName', 1.5, -4)
    expect(ctx.fillText).toHaveBeenCalledWith('translated:patternName', 1.5, 34)
    expect(new Set(strokeColors)).toEqual(new Set(['#ef5350', '#26a69a']))
  })
})
