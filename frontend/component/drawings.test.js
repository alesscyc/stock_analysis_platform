import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDrawingsPrimitive,
  distanceToRay,
  distanceToSegment,
  loadDrawings,
  priceRangeLabel,
  priceRangeStats,
  saveDrawings,
} from './drawings'

const line = {
  type: 'trendline',
  start: { time: '2026-01-02', price: 100 },
  end: { time: '2026-01-03', price: 110 },
}

describe('drawings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores drawings by normalized symbol', () => {
    saveDrawings('aapl', [line])

    expect(localStorage.getItem('stockai-drawings:AAPL')).toBe(JSON.stringify([line]))
    expect(localStorage.getItem('stockai-drawings:aapl')).toBeNull()
    expect(loadDrawings('AAPL')).toEqual([line])
    expect(loadDrawings('MSFT')).toEqual([])
  })

  it('migrates legacy trend-line storage into typed drawings', () => {
    const legacy = {
      start: { time: '2026-01-02', price: 100 },
      end: { time: '2026-01-03', price: 110 },
    }
    localStorage.setItem('stockai-trend-lines:AAPL', JSON.stringify([legacy]))

    expect(loadDrawings('AAPL')).toEqual([{ type: 'trendline', ...legacy }])
    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([
      { type: 'trendline', ...legacy },
    ])
  })

  it('returns an empty array for stored non-array JSON', () => {
    localStorage.setItem('stockai-drawings:AAPL', JSON.stringify({ line }))

    expect(loadDrawings('AAPL')).toEqual([])
  })

  it('returns an empty array for malformed JSON', () => {
    localStorage.setItem('stockai-drawings:AAPL', '{malformed')

    expect(loadDrawings('AAPL')).toEqual([])
  })

  it('keeps valid typed drawings and rejects invalid records', () => {
    const numericTimeLine = {
      type: 'trendline',
      start: { time: 1767312000, price: 100 },
      end: { time: 1767398400, price: 110 },
    }
    const businessDayLine = {
      type: 'ray',
      start: { time: { year: 2026, month: 1, day: 2 }, price: 100 },
      end: { time: { year: 2026, month: 1, day: 3 }, price: 110 },
    }
    const hline = { type: 'hline', price: 105 }
    const rect = {
      type: 'rect',
      start: { time: '2026-01-02', price: 100 },
      end: { time: '2026-01-03', price: 110 },
    }
    const priceRange = {
      type: 'pricerange',
      start: { time: '2026-01-02', price: 100 },
      end: { time: '2026-01-03', price: 110 },
    }
    const invalid = [
      { type: 'hline' },
      { type: 'trendline', start: line.start },
      { type: 'rect', start: { ...line.start, price: '100' }, end: line.end },
      { type: 'nope', start: line.start, end: line.end },
    ]

    saveDrawings('AAPL', [line, numericTimeLine, businessDayLine, hline, rect, priceRange, ...invalid])

    expect(loadDrawings('AAPL')).toEqual([line, numericTimeLine, businessDayLine, hline, rect, priceRange])
  })

  it('formats price range labels with delta and percent only', () => {
    expect(priceRangeLabel(100, 110)).toBe('10.00 (10.00%)')
    expect(priceRangeLabel(66.92, 76.67)).toBe('9.75 (14.57%)')
    expect(priceRangeStats(100, 110).up).toBe(true)
    expect(priceRangeStats(110, 100).up).toBe(false)
  })

  it('rejects non-finite prices', () => {
    const infinitePriceLine = '{"type":"trendline","start":{"time":"2026-01-02","price":1e400},"end":{"time":"2026-01-03","price":110}}'
    localStorage.setItem('stockai-drawings:AAPL', `[${JSON.stringify(line)},${infinitePriceLine}]`)

    expect(loadDrawings('AAPL')).toEqual([line])
  })

  it('does not write to storage without a symbol', () => {
    saveDrawings(undefined, [line])

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

  it('measures distance to a ray beyond the end point', () => {
    expect(distanceToRay(15, 0, 0, 0, 10, 0)).toBe(0)
    expect(distanceToRay(-5, 0, 0, 0, 10, 0)).toBe(5)
  })

  it('finds rendered trend lines within six pixels', () => {
    const primitive = createDrawingsPrimitive()
    primitive.attached({
      chart: {
        timeScale: () => ({
          timeToCoordinate: time => time === 'a' ? 10 : 90,
          width: () => 100,
        }),
      },
      series: {
        priceToCoordinate: price => price,
      },
      requestUpdate: () => {},
    })
    primitive.setDrawings([{
      type: 'trendline',
      start: { time: 'a', price: 20 },
      end: { time: 'b', price: 20 },
    }])

    expect(primitive.drawingIndexAt(50, 24)).toBe(0)
    expect(primitive.drawingIndexAt(50, 30)).toBe(-1)
    expect(primitive.hitTest).toBeUndefined()
  })

  it('hit-tests hline, rect, and ray', () => {
    const primitive = createDrawingsPrimitive()
    primitive.attached({
      chart: {
        timeScale: () => ({
          timeToCoordinate: time => ({ a: 10, b: 90 }[time] ?? null),
          width: () => 200,
        }),
      },
      series: { priceToCoordinate: price => price },
      requestUpdate: () => {},
    })
    primitive.setDrawings([
      { type: 'hline', price: 40 },
      {
        type: 'rect',
        start: { time: 'a', price: 10 },
        end: { time: 'b', price: 30 },
      },
      {
        type: 'ray',
        start: { time: 'a', price: 50 },
        end: { time: 'b', price: 50 },
      },
    ])

    expect(primitive.drawingIndexAt(50, 42)).toBe(0)
    expect(primitive.drawingIndexAt(50, 10)).toBe(1)
    expect(primitive.drawingIndexAt(150, 50)).toBe(2)
    expect(primitive.drawingIndexAt(50, 80)).toBe(-1)
  })

  it('returns the last overlapping drawing', () => {
    const primitive = createDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: time => time === 'a' ? 10 : 90 }) },
      series: { priceToCoordinate: price => price },
      requestUpdate: () => {},
    })
    primitive.setDrawings([
      { type: 'trendline', start: { time: 'a', price: 20 }, end: { time: 'b', price: 20 } },
      { type: 'trendline', start: { time: 'a', price: 20 }, end: { time: 'b', price: 20 } },
    ])

    expect(primitive.drawingIndexAt(50, 20)).toBe(1)
  })

  it('skips drawings with null coordinates', () => {
    const primitive = createDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: time => time === 'missing' ? null : 10 }) },
      series: { priceToCoordinate: price => price },
      requestUpdate: () => {},
    })
    primitive.setDrawings([
      { type: 'trendline', start: { time: 'a', price: 20 }, end: { time: 'b', price: 20 } },
      { type: 'trendline', start: { time: 'missing', price: 20 }, end: { time: 'b', price: 20 } },
    ])

    expect(primitive.drawingIndexAt(10, 20)).toBe(0)
  })

  it('requests a redraw when drawings change', () => {
    const requestUpdate = vi.fn()
    const primitive = createDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 0 }) },
      series: { priceToCoordinate: price => price },
      requestUpdate,
    })

    primitive.setDrawings([line], 0)

    expect(requestUpdate).toHaveBeenCalledOnce()
  })

  it('draws normal and selected trend lines in bitmap coordinates', () => {
    const strokes = []
    let from
    let to
    const context = {
      beginPath() {},
      moveTo(x, y) { from = [x, y] },
      lineTo(x, y) { to = [x, y] },
      stroke() {
        strokes.push({
          color: this.strokeStyle,
          width: this.lineWidth,
          from,
          to,
        })
      },
      fillRect() {},
      strokeRect() {},
      setLineDash() {},
    }
    const primitive = createDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: time => time === 'a' ? 5 : 15, width: () => 40 }) },
      series: { priceToCoordinate: price => price },
      requestUpdate: () => {},
    })
    primitive.setDrawings([
      { type: 'trendline', start: { time: 'a', price: 10 }, end: { time: 'b', price: 10 } },
      { type: 'trendline', start: { time: 'a', price: 20 }, end: { time: 'b', price: 20 } },
    ], 1)

    primitive.paneViews()[0].renderer().draw({
      useBitmapCoordinateSpace: draw => draw({
        context,
        horizontalPixelRatio: 3,
        verticalPixelRatio: 2,
        mediaSize: { width: 40, height: 40 },
        bitmapSize: { width: 120, height: 80 },
      }),
    })

    expect(strokes).toEqual([
      { color: '#2962ff', width: 6, from: [15, 20], to: [45, 20] },
      { color: '#ffffff', width: 9, from: [15, 40], to: [45, 40] },
    ])
  })

  it('stops finding drawings after detaching', () => {
    const primitive = createDrawingsPrimitive()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 10 }) },
      series: { priceToCoordinate: price => price },
      requestUpdate: () => {},
    })
    primitive.setDrawings([line])
    primitive.detached()

    expect(primitive.drawingIndexAt(10, 100)).toBe(-1)
  })
})
