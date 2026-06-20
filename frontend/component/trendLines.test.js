import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTrendLinesPrimitive,
  distanceToSegment,
  loadTrendLines,
  saveTrendLines,
} from './trendLines'

const line = {
  start: { time: '2026-01-02', price: 100 },
  end: { time: '2026-01-03', price: 110 },
}

describe('trend lines', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores lines by normalized symbol', () => {
    saveTrendLines('aapl', [line])

    expect(localStorage.getItem('stockai-trend-lines:AAPL')).toBe(JSON.stringify([line]))
    expect(localStorage.getItem('stockai-trend-lines:aapl')).toBeNull()
    expect(loadTrendLines('AAPL')).toEqual([line])
    expect(loadTrendLines('MSFT')).toEqual([])
  })

  it('returns an empty array for stored non-array JSON', () => {
    localStorage.setItem('stockai-trend-lines:AAPL', JSON.stringify({ line }))

    expect(loadTrendLines('AAPL')).toEqual([])
  })

  it('returns an empty array for malformed JSON', () => {
    localStorage.setItem('stockai-trend-lines:AAPL', '{malformed')

    expect(loadTrendLines('AAPL')).toEqual([])
  })

  it('keeps valid string, numeric, and BusinessDay lines while rejecting invalid records', () => {
    const numericTimeLine = {
      start: { time: 1767312000, price: 100 },
      end: { time: 1767398400, price: 110 },
    }
    const businessDayLine = {
      start: { time: { year: 2026, month: 1, day: 2 }, price: 100 },
      end: { time: { year: 2026, month: 1, day: 3 }, price: 110 },
    }
    const invalidLines = [
      { start: line.start },
      { start: { ...line.start, price: '100' }, end: line.end },
      { start: { ...line.start, time: { year: 2026, month: 1.5, day: 2 } }, end: line.end },
    ]

    saveTrendLines('AAPL', [line, numericTimeLine, businessDayLine, ...invalidLines])

    expect(loadTrendLines('AAPL')).toEqual([line, numericTimeLine, businessDayLine])
  })

  it('rejects non-finite prices', () => {
    const infinitePriceLine = '{"start":{"time":"2026-01-02","price":1e400},"end":{"time":"2026-01-03","price":110}}'
    localStorage.setItem('stockai-trend-lines:AAPL', `[${JSON.stringify(line)},${infinitePriceLine}]`)

    expect(loadTrendLines('AAPL')).toEqual([line])
  })

  it('does not write to storage without a symbol', () => {
    saveTrendLines(undefined, [line])

    expect(localStorage.length).toBe(0)
  })

  it('measures projection and endpoint distances to a line segment', () => {
    expect(distanceToSegment(5, 2, 0, 0, 10, 0)).toBe(2)
    expect(distanceToSegment(15, 0, 0, 0, 10, 0)).toBe(5)
    expect(distanceToSegment(3, 5, 0, 0, 0, 10)).toBe(3)
    expect(distanceToSegment(-5, 0, 0, 0, 10, 0)).toBe(5)
  })

  it('measures distance to a zero-length segment', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5)
  })

  it('hit-tests rendered trend lines within six pixels', () => {
    const primitive = createTrendLinesPrimitive()
    primitive.attached({
      chart: {
        timeScale: () => ({
          timeToCoordinate: time => time === 'a' ? 10 : 90,
        }),
      },
      series: {
        priceToCoordinate: price => price,
      },
      requestUpdate: () => {},
    })
    primitive.setLines([{
      start: { time: 'a', price: 20 },
      end: { time: 'b', price: 20 },
    }])

    expect(primitive.hitTest(50, 24)).toBe(0)
    expect(primitive.hitTest(50, 30)).toBe(-1)
  })
})
