import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

vi.mock('../component/StockChart', () => ({
  default: ({ stockData, stockSymbol }) => (
    <div data-testid="stock-chart">{stockSymbol}:{stockData.length}</div>
  ),
}))

vi.mock('../component/ScreenerDialog', () => ({
  default: ({ onStockDataScanned, onStockSelect }) => (
    <>
      <button onClick={() => {
        onStockDataScanned('MSFT', [
          { Date: '2026-08-11', Open: 20, High: 22, Low: 19, Close: 21, Volume: 200 },
        ], { dateRange: 'max', interval: '1d' })
      }}>
        Cache scanned stock
      </button>
      <button onClick={() => onStockSelect({ symbol: 'MSFT' })}>
        Select scanned stock
      </button>
    </>
  ),
}))

const ok = data => ({ ok: true, json: async () => data })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('renders the topbar brand icon', () => {
    render(<App />)
    const brand = screen.getByText(/StockAI/i)
    expect(brand).toBeInTheDocument()
  })

  it('renders search bar placeholder', () => {
    render(<App />)
    const input = screen.getByPlaceholderText(/Search ticker/i)
    expect(input).toBeInTheDocument()
  })

  it('renders recent candles before AI and older history finish', async () => {
    let historyCalls = 0
    let predictionCalls = 0
    const historyUrls = []
    let resolvePrediction
    let resolveBackfill
    const prediction = new Promise(resolve => { resolvePrediction = resolve })
    const backfill = new Promise(resolve => { resolveBackfill = resolve })

    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/ib/status') return Promise.resolve(ok({ connected: false }))
      if (url.startsWith('/api/fundamentals/')) return Promise.resolve(ok({}))
      if (url.startsWith('/api/prediction/')) {
        predictionCalls += 1
        return prediction
      }
      if (url.startsWith('/api/stock/')) {
        historyCalls += 1
        historyUrls.push(url)
        return historyCalls === 1
          ? Promise.resolve(ok([{ Date: '2026-08-11', Open: 10, High: 12, Low: 9, Close: 11, Volume: 100 }]))
          : backfill
      }
      return Promise.resolve(ok([]))
    }))

    render(<App />)
    const input = screen.getByPlaceholderText(/Search ticker/i)
    fireEvent.change(input, { target: { value: 'AAPL' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByTestId('stock-chart')).toHaveTextContent('1')
    expect(screen.getByText('AI analyzing…')).toBeInTheDocument()
    expect(screen.getByText('Loading older history…')).toBeInTheDocument()
    expect(historyCalls).toBe(2)

    await act(async () => {
      resolvePrediction(ok({ status: 'insufficient_data' }))
      resolveBackfill(ok([]))
      await Promise.resolve()
    })

    expect(await screen.findByText('AI unavailable')).toBeInTheDocument()
    await waitFor(() => expect(historyCalls).toBe(7))
    expect(historyUrls.at(-1)).toContain('start_date=1900-01-01')
    expect(historyUrls.at(-1)).not.toContain('end_date=1900-01-01')
    expect(screen.queryByText('History partially loaded')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'AAPL' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(predictionCalls).toBe(2))
    expect(historyCalls).toBe(7)
  })

  it('adapts full-history screener data into the chart cache', async () => {
    let stockCalls = 0
    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/ib/status') return Promise.resolve(ok({ connected: false }))
      if (url.startsWith('/api/fundamentals/')) return Promise.resolve(ok({}))
      if (url.startsWith('/api/prediction/')) {
        return Promise.resolve(ok({ status: 'success', recommendation: 'BUY', confidence: 80 }))
      }
      if (url.startsWith('/api/stock/')) stockCalls += 1
      return Promise.resolve(ok([]))
    }))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Cache scanned stock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select scanned stock' }))

    expect(await screen.findByTestId('stock-chart')).toHaveTextContent('1')
    expect(stockCalls).toBe(0)
  })

  it('continues backfill past one empty five-year window', async () => {
    let historyCalls = 0
    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/ib/status') return Promise.resolve(ok({ connected: false }))
      if (url.startsWith('/api/fundamentals/')) return Promise.resolve(ok({}))
      if (url.startsWith('/api/prediction/')) {
        return Promise.resolve(ok({ status: 'success', recommendation: 'BUY', confidence: 80 }))
      }
      if (url.startsWith('/api/stock/')) {
        historyCalls += 1
        if (historyCalls === 1) {
          return Promise.resolve(ok([{ Date: '2026-08-11', Open: 10, High: 12, Low: 9, Close: 11, Volume: 100 }]))
        }
        if (historyCalls === 4) {
          return Promise.resolve(ok([{ Date: '2015-08-11', Open: 5, High: 7, Low: 4, Close: 6, Volume: 90 }]))
        }
        return Promise.resolve(ok([]))
      }
      return Promise.resolve(ok([]))
    }))

    render(<App />)
    const input = screen.getByPlaceholderText(/Search ticker/i)
    fireEvent.change(input, { target: { value: 'AAPL' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('stock-chart')).toHaveTextContent('2'))
    await waitFor(() => expect(historyCalls).toBe(10))
    expect(screen.queryByText('Loading older history…')).not.toBeInTheDocument()
  })

  it('reports a stale recent refresh separately from history backfill', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/ib/status') return Promise.resolve(ok({ connected: false }))
      if (url.startsWith('/api/fundamentals/')) return Promise.resolve(ok({}))
      if (url.startsWith('/api/prediction/')) {
        return Promise.resolve(ok({ status: 'success', recommendation: 'BUY', confidence: 80 }))
      }
      if (url.startsWith('/api/stock/')) return Promise.reject(new Error('provider down'))
      return Promise.resolve(ok([]))
    }))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Cache scanned stock' }))
    now += 6 * 60 * 1000
    fireEvent.click(screen.getByRole('button', { name: 'Select scanned stock' }))

    expect(await screen.findByTestId('stock-chart')).toHaveTextContent('1')
    expect(await screen.findByText('Recent data refresh failed')).toBeInTheDocument()
    expect(screen.queryByText('History partially loaded')).not.toBeInTheDocument()
  })

  it('ignores a backfill response after selecting another symbol', async () => {
    let aaplCalls = 0
    let msftCalls = 0
    let resolveAaplBackfill
    const aaplBackfill = new Promise(resolve => { resolveAaplBackfill = resolve })
    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/ib/status') return Promise.resolve(ok({ connected: false }))
      if (url.startsWith('/api/fundamentals/')) return Promise.resolve(ok({}))
      if (url.startsWith('/api/prediction/')) {
        return Promise.resolve(ok({ status: 'success', recommendation: 'BUY', confidence: 80 }))
      }
      if (url.startsWith('/api/stock/AAPL')) {
        aaplCalls += 1
        return aaplCalls === 1
          ? Promise.resolve(ok([{ Date: '2026-08-11', Open: 10, High: 12, Low: 9, Close: 11, Volume: 100 }]))
          : aaplBackfill
      }
      if (url.startsWith('/api/stock/MSFT')) {
        msftCalls += 1
        return msftCalls === 1
          ? Promise.resolve(ok([{ Date: '2026-08-11', Open: 20, High: 22, Low: 19, Close: 21, Volume: 200 }]))
          : Promise.resolve(ok([]))
      }
      return Promise.resolve(ok([]))
    }))

    render(<App />)
    let input = screen.getByPlaceholderText(/Search ticker/i)
    fireEvent.change(input, { target: { value: 'AAPL' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('stock-chart')).toHaveTextContent('AAPL:1'))

    input = screen.getByPlaceholderText(/Search ticker/i)
    fireEvent.change(input, { target: { value: 'MSFT' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('stock-chart')).toHaveTextContent('MSFT:1'))

    await act(async () => {
      resolveAaplBackfill(ok([{ Date: '2015-08-11', Open: 5, High: 7, Low: 4, Close: 6, Volume: 90 }]))
      await Promise.resolve()
    })

    expect(screen.getByTestId('stock-chart')).toHaveTextContent('MSFT:1')
  })
})
