import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../src/i18n/I18nContext.jsx'
import StockChart from './StockChart'

const chartMock = vi.hoisted(() => {
  let clickHandler
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
      clickHandler = undefined
      candleSeries = createSeries()
      const timeScale = {
        setVisibleRange: vi.fn(),
        timeToCoordinate: vi.fn(time => ({
          '2026-01-02': 10,
          '2026-01-03': 30,
        })[time] ?? null),
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
        subscribeClick: vi.fn(handler => {
          clickHandler = handler
        }),
        timeScale: vi.fn(() => timeScale),
        unsubscribeClick: vi.fn(),
      }
    },
    createChart: vi.fn(() => chart),
    click(params) {
      clickHandler?.(params)
    },
  }
})

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: Symbol('CandlestickSeries'),
  CrosshairMode: { Normal: 0 },
  HistogramSeries: Symbol('HistogramSeries'),
  LineSeries: Symbol('LineSeries'),
  LineStyle: { Dotted: 1, Solid: 0 },
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

  it('draws, selects, and deletes a persisted trend line', () => {
    renderChart()

    fireEvent.click(screen.getByRole('button', { name: 'Trend Line' }))
    act(() => {
      chartMock.click({ point: { x: 10, y: 100 }, time: '2026-01-02' })
      chartMock.click({ point: { x: 30, y: 120 }, time: '2026-01-03' })
    })

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toEqual([
      {
        start: { time: '2026-01-02', price: 100 },
        end: { time: '2026-01-03', price: 120 },
      },
    ])

    fireEvent.mouseDown(document.getElementById('lw-chart-container'), {
      clientX: 20,
      clientY: 110,
    })
    fireEvent.keyDown(window, { key: 'Delete' })

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toEqual([])
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
})
