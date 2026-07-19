import { describe, expect, it, vi } from 'vitest'
import {
  detectDoubleBottoms,
  detectDoubleTops,
  detectPricePatterns,
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

describe('price patterns', () => {
  it('keeps failed patterns as dotted overlays in the chart feed', () => {
    const failed = downtrend.map(bar => bar.time === 12
      ? candle(12, 105, 95, 99)
      : bar)

    expect(detectPricePatterns(failed, options)).toMatchObject([
      { type: 'double-bottom', status: 'failed' },
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
