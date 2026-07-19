import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../src/i18n/I18nContext.jsx'
import StockChart from './StockChart'

const chartMock = vi.hoisted(() => {
  let chart
  let candleSeries

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
      const timeScale = {
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
  }
})

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: Symbol('CandlestickSeries'),
  CrosshairMode: { Normal: 0 },
  HistogramSeries: Symbol('HistogramSeries'),
  LineSeries: Symbol('LineSeries'),
  LineStyle: { Dotted: 1, Solid: 0 },
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

function renderChart() {
  return render(
    <I18nProvider>
      <StockChart
        stockData={stockData}
        stockSymbol="AAPL"
        currentInterval="1d"
        onIntervalChange={vi.fn()}
        ibConnected={false}
      />
    </I18nProvider>,
  )
}

describe('StockChart trend lines', () => {
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

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toEqual([
      {
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ])

    fireEvent.mouseDown(container, {
      clientX: 20,
      clientY: 110,
    })
    fireEvent.keyDown(window, { key: 'Delete' })

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toEqual([])
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

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toEqual([
      {
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
    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL') ?? '[]')).toEqual([])
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
    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL') ?? '[]')).toEqual([])
  })

  it('removes a selected trend line with Backspace', () => {
    localStorage.setItem('stockai-trend-lines:AAPL', JSON.stringify([
      {
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

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toEqual([])
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
