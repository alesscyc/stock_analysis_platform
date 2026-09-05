import { useState } from 'react'
import TradeDialog from './TradeDialog'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../src/i18n/I18nContext.jsx'
import StockChart from './StockChart'

const chartMock = vi.hoisted(() => {
  let chart
  let candleSeries
  let timeScale

  const createSeries = () => ({
    applyOptions: vi.fn(),
    attachPrimitive: vi.fn(),
    coordinateToPrice: vi.fn(y => y),
    createPriceLine: vi.fn(() => ({})),
    priceToCoordinate: vi.fn(price => price),
    removePriceLine: vi.fn(),
    setData: vi.fn(),
  })

  return {
    reset() {
      candleSeries = createSeries()
      timeScale = {
        getVisibleRange: vi.fn(() => null),
        setVisibleRange: vi.fn(),
        timeToCoordinate: vi.fn(time => ({
          '2026-01-02': 10,
          '2026-01-03': 30,
        })[time] ?? null),
        coordinateToTime: vi.fn(x => ({
          10: '2026-01-02',
          30: '2026-01-03',
        })[x] ?? null),
        width: vi.fn(() => 400),
      }
      chart = {
        addSeries: vi.fn(() => {
          const series = chart.addSeries.mock.calls.length === 1
            ? candleSeries
            : createSeries()
          series.attachPrimitive.mockImplementation(primitive => {
            primitive.attached?.({
              chart,
              series,
              requestUpdate: vi.fn(),
            })
          })
          return series
        }),
        applyOptions: vi.fn(),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        remove: vi.fn(),
        resize: vi.fn(),
        subscribeClick: vi.fn(),
        timeScale: vi.fn(() => timeScale),
        unsubscribeClick: vi.fn(),
      }
    },
    createChart: vi.fn(() => chart),
    getTimeScale: () => timeScale,
    getCandleSeries: () => candleSeries,
  }
})

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: Symbol('CandlestickSeries'),
  CrosshairMode: { Normal: 0 },
  HistogramSeries: Symbol('HistogramSeries'),
  LineSeries: Symbol('LineSeries'),
  LineStyle: { Dotted: 1, Solid: 0, Dashed: 2 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
  createChart: chartMock.createChart,
  createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn(), detach: vi.fn() })),
}))

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const stockData = [
  { Date: '2026-01-02', Open: 95, High: 105, Low: 90, Close: 100, Volume: 1000 },
  { Date: '2026-01-03', Open: 105, High: 125, Low: 100, Close: 120, Volume: 1200 },
]

function chartElement(data = stockData) {
  return (
    <I18nProvider>
      <StockChart
        stockData={data}
        stockSymbol="AAPL"
        currentInterval="1d"
        onIntervalChange={vi.fn()}
        ibConnected={false}
      />
    </I18nProvider>
  )
}

function renderChart(data) {
  return render(chartElement(data))
}

describe('StockChart drawings', () => {
  beforeEach(() => {
    localStorage.clear()
    chartMock.reset()
    globalThis.ResizeObserver = ResizeObserverStub
  })

  it('draws by drag, selects, and deletes a persisted trend line', () => {
    renderChart()

    const container = document.getElementById('lw-chart-container')
    fireEvent.click(screen.getByRole('button', { name: 'Trend Line' }))
    fireEvent.mouseDown(container, { clientX: 10, clientY: 100 })
    fireEvent.mouseMove(container, { clientX: 30, clientY: 120 })
    fireEvent.mouseUp(window, { clientX: 30, clientY: 120 })

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([
      {
        type: 'trendline',
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ])

    fireEvent.mouseDown(container, {
      clientX: 20,
      clientY: 110,
    })
    fireEvent.keyDown(window, { key: 'Delete' })

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([])
  })

  it('draws a trend line with click-click', () => {
    renderChart()

    const container = document.getElementById('lw-chart-container')
    fireEvent.click(screen.getByRole('button', { name: 'Trend Line' }))
    fireEvent.mouseDown(container, { clientX: 10, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 10, clientY: 100 })
    fireEvent.mouseMove(container, { clientX: 30, clientY: 120 })
    fireEvent.mouseDown(container, { clientX: 30, clientY: 120 })
    fireEvent.mouseUp(window, { clientX: 30, clientY: 120 })

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([
      {
        type: 'trendline',
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ])
  })

  it('cancels in-progress trend line drawing on right-click', () => {
    renderChart()

    const container = document.getElementById('lw-chart-container')
    const btn = screen.getByRole('button', { name: 'Trend Line' })
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')

    fireEvent.mouseDown(container, { clientX: 10, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 10, clientY: 100 })
    fireEvent.contextMenu(container)

    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL') ?? '[]')).toEqual([])
  })

  it('cancels mid-drag trend line on right mouse button', () => {
    renderChart()

    const container = document.getElementById('lw-chart-container')
    const btn = screen.getByRole('button', { name: 'Trend Line' })
    fireEvent.click(btn)
    fireEvent.mouseDown(container, { clientX: 10, clientY: 100, button: 0 })
    fireEvent.mouseMove(container, { clientX: 30, clientY: 120 })
    // Right-click during drag used to commit via mouseup; must cancel instead
    fireEvent.mouseDown(container, { clientX: 30, clientY: 120, button: 2 })
    fireEvent.mouseUp(window, { clientX: 30, clientY: 120, button: 2 })

    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL') ?? '[]')).toEqual([])
  })

  it('removes a selected trend line with Backspace', () => {
    localStorage.setItem('stockai-drawings:AAPL', JSON.stringify([
      {
        type: 'trendline',
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ]))
    renderChart()

    fireEvent.mouseDown(document.getElementById('lw-chart-container'), {
      clientX: 20,
      clientY: 110,
    })
    fireEvent.keyDown(window, { key: 'Backspace' })

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([])
  })

  it('draws a horizontal line with one click', () => {
    renderChart()

    const container = document.getElementById('lw-chart-container')
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal Line' }))
    fireEvent.mouseDown(container, { clientX: 10, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 10, clientY: 100 })

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([
      { type: 'hline', price: 100 },
    ])
  })

  it('draws a rectangle with two points', () => {
    renderChart()

    const container = document.getElementById('lw-chart-container')
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }))
    fireEvent.mouseDown(container, { clientX: 10, clientY: 100 })
    fireEvent.mouseMove(container, { clientX: 30, clientY: 120 })
    fireEvent.mouseUp(window, { clientX: 30, clientY: 120 })

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([
      {
        type: 'rect',
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ])
  })

  it('draws a price range with two points', () => {
    renderChart()

    const container = document.getElementById('lw-chart-container')
    fireEvent.click(screen.getByRole('button', { name: 'Price Range' }))
    fireEvent.mouseDown(container, { clientX: 10, clientY: 100 })
    fireEvent.mouseMove(container, { clientX: 30, clientY: 120 })
    fireEvent.mouseUp(window, { clientX: 30, clientY: 120 })

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([
      {
        type: 'pricerange',
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ])
  })

  it('clears all drawings', () => {
    localStorage.setItem('stockai-drawings:AAPL', JSON.stringify([
      { type: 'hline', price: 100 },
      {
        type: 'trendline',
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ]))
    renderChart()

    fireEvent.click(screen.getByRole('button', { name: 'Clear all drawings' }))

    expect(JSON.parse(localStorage.getItem('stockai-drawings:AAPL'))).toEqual([])
  })
})

describe('StockChart indicators', () => {
  beforeEach(() => {
    localStorage.clear()
    chartMock.reset()
    globalThis.ResizeObserver = ResizeObserverStub
  })

  it('checks moving average indicators by default', () => {
    renderChart()

    fireEvent.click(screen.getByRole('button', { name: /Indicators/i }))

    expect(screen.getByRole('checkbox', { name: '200 MA' })).toBeChecked()
  })

  it('uses one persisted Price Pattern toggle', () => {
    renderChart()

    fireEvent.click(screen.getByRole('button', { name: /Indicators/i }))
    const toggle = screen.getByRole('checkbox', { name: 'Price Pattern' })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)
    expect(localStorage.getItem('chart-price-pattern-visible')).toBe('false')
  })

  it('migrates the old double-bottom visibility preference', () => {
    localStorage.setItem('chart-double-bottom-visible', 'false')
    renderChart()

    fireEvent.click(screen.getByRole('button', { name: /Indicators/i }))
    expect(screen.getByRole('checkbox', { name: 'Price Pattern' })).not.toBeChecked()
  })
})

describe('StockChart progressive data', () => {
  beforeEach(() => {
    localStorage.clear()
    chartMock.reset()
    globalThis.ResizeObserver = ResizeObserverStub
  })

  it('preserves the visible dates when older candles are prepended', () => {
    const visibleRange = { from: '2026-01-02', to: '2026-01-03' }
    const { rerender } = renderChart()
    chartMock.getTimeScale().getVisibleRange.mockReturnValue(visibleRange)

    rerender(chartElement([
      { Date: '2025-01-02', Open: 80, High: 90, Low: 75, Close: 85, Volume: 900 },
      ...stockData,
    ]))

    expect(chartMock.getTimeScale().setVisibleRange).toHaveBeenLastCalledWith(visibleRange)
  })
})

function OrderPreviewHarness() {
  const [preview, setPreview] = useState(null)
  const [open, setOpen] = useState(true)
  const [priceChange, setPriceChange] = useState(null)
  return <I18nProvider>
    <StockChart stockData={stockData} stockSymbol="AAPL" currentInterval="1d"
      ibConnected={false} orderPreview={open ? preview : null} onPreviewPriceDrag={setPriceChange} />
    <TradeDialog isOpen={open} onClose={() => setOpen(false)} stockSymbol="AAPL"
      ibConnected={false} onPreviewChange={setPreview} previewPriceChange={priceChange} />
  </I18nProvider>
}

describe('draft order price lines', () => {
  it('updates entry and bracket lines while typing and clears disabled or closed previews', () => {
    localStorage.clear()
    chartMock.reset()
    globalThis.ResizeObserver = ResizeObserverStub
    render(<OrderPreviewHarness />)
    const series = chartMock.getCandleSeries()
    const activePrices = () => series.createPriceLine.mock.calls
      .filter((_, index) => !series.removePriceLine.mock.calls.some(
        ([line]) => line === series.createPriceLine.mock.results[index].value,
      )).map(([options]) => options.price)

    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '100' } })
    expect(activePrices()).toEqual([100])
    fireEvent.click(document.getElementById('trade-bracket-toggle-input'))
    fireEvent.change(screen.getByLabelText('Take Profit (USD)'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('Stop Loss (USD)'), { target: { value: '90' } })
    expect(activePrices()).toEqual([100, 90, 120])
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '105' } })
    expect(activePrices()).toEqual([105, 90, 120])
    fireEvent.change(screen.getByLabelText('Stop Loss (USD)'), { target: { value: '-1' } })
    expect(activePrices()).toEqual([105, 120])
    fireEvent.click(document.getElementById('trade-bracket-toggle-input'))
    expect(activePrices()).toEqual([105])
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    expect(activePrices()).toEqual([])
  })
})

describe('drag draft exits', () => {
  beforeEach(() => {
    localStorage.clear()
    chartMock.reset()
    globalThis.ResizeObserver = ResizeObserverStub
  })

  it.each(['Buy', 'Sell'])('creates and adjusts %s exits using buttons and changes entry by dragging its line', (action) => {
    const submit = vi.fn()
    vi.stubGlobal('fetch', submit)
    render(<OrderPreviewHarness />)
    fireEvent.click(screen.getByRole('button', { name: action.toUpperCase(), exact: true }))
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '100' } })
    const chart = document.getElementById('lw-chart-container')
    const drag = (from, to) => {
      fireEvent.mouseDown(chart, { clientX: 10, clientY: from, button: 0 })
      fireEvent.mouseMove(chart, { clientX: 10, clientY: to })
      fireEvent.mouseUp(window, { clientX: 10, clientY: to, button: 0 })
    }
    const loss = action === 'Buy' ? 80 : 120
    const profit = action === 'Buy' ? 120 : 80
    fireEvent.mouseDown(screen.getByRole('button', { name: /Drag to set stop loss/ }), { button: 0 })
    fireEvent.mouseMove(chart, { clientX: 10, clientY: loss })
    fireEvent.mouseUp(window, { button: 0 })
    expect(screen.getByLabelText('Stop Loss (USD)')).toHaveValue(loss)
    expect(document.getElementById('trade-bracket-toggle-input')).toBeChecked()
    fireEvent.mouseDown(screen.getByRole('button', { name: /Drag to set take profit/ }), { button: 0 })
    fireEvent.mouseMove(chart, { clientX: 10, clientY: profit })
    fireEvent.mouseUp(window, { button: 0 })
    expect(screen.getByLabelText('Take Profit (USD)')).toHaveValue(profit)
    drag(loss, loss + 2)
    expect(screen.getByLabelText('Stop Loss (USD)')).toHaveValue(loss + 2)
    drag(100, 105)
    expect(screen.getByLabelText('Price (USD)')).toHaveValue(105)
    expect(screen.getByLabelText('Take Profit (USD)')).toHaveValue(profit)
    expect(screen.getByLabelText('Stop Loss (USD)')).toHaveValue(loss + 2)
    expect(submit).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
