import { describe, expect, it } from 'vitest'
import { detectDoubleBottoms, detectDoubleTops } from './doubleBottom'

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
    expect(detectDoubleBottoms(downtrend, options)).toHaveLength(1)
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
