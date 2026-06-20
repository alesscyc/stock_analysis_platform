import { beforeEach, describe, expect, it } from 'vitest'
import { distanceToSegment, loadTrendLines, saveTrendLines } from './trendLines'

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

    expect(loadTrendLines('AAPL')).toEqual([line])
    expect(loadTrendLines('MSFT')).toEqual([])
  })

  it('returns an empty array for stored non-array JSON', () => {
    localStorage.setItem('stockai-trend-lines:AAPL', JSON.stringify({ line }))

    expect(loadTrendLines('AAPL')).toEqual([])
  })

  it('measures distance to a line segment', () => {
    expect(distanceToSegment(5, 2, 0, 0, 10, 0)).toBe(2)
    expect(distanceToSegment(15, 0, 0, 0, 10, 0)).toBe(5)
  })
})
