import { describe, expect, it } from 'vitest'
import { detectDoubleBottoms } from './doubleBottom'

const candle = (time, high, low, close = high - 1) => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 100,
})

describe('double bottom', () => {
  it('requires a downtrend before the first bottom', () => {
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
    const options = {
      leftBars: 1,
      rightBars: 1,
      minBarsBetweenBottoms: 4,
      maxBarsBetweenBottoms: 8,
    }
    const uptrend = downtrend.map((bar, index) => {
      if (index === 1) return { ...bar, high: 115 }
      if (index === 2) return { ...bar, low: 90 }
      return bar
    })

    expect(detectDoubleBottoms(uptrend, options)).toEqual([])
    expect(detectDoubleBottoms(downtrend, options)).toHaveLength(1)
  })
})
