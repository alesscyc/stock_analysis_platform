import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchBar from './SearchBar';
import WatchlistDialog from './WatchlistDialog';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([['search bar', SearchBar], ['watchlist', WatchlistDialog]])('%s suggestions', (...args) => {
  const Component = args[1];
  it('ignores older responses and aborts requests after clearing the input', async () => {
    const requests = [];
    localStorage.setItem('stockai-watchlist', JSON.stringify([{ symbol: 'NVDA', description: 'Nvidia' }]));
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, { signal } = {}) => {
      if (url.startsWith('/api/price/')) {
        return Promise.resolve({ ok: true, json: async () => ({ price: 123.45 }) });
      }
      return new Promise(resolve => { requests.push({ signal, resolve }); });
    });
    render(<Component isOpen onClose={() => {}} onStockSelect={() => {}} />);
    const input = screen.getByRole('textbox');
    const type = async value => {
      fireEvent.change(input, { target: { value } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    };
    const resolve = async (index, symbol) => {
      await act(async () => {
        requests[index].resolve({ ok: true, json: async () => [{ symbol, description: symbol }] });
      });
    };
    await type('A');
    if (Component === WatchlistDialog) expect(screen.getByText('$123.45')).toBeInTheDocument();
    await type('M');
    expect(requests[0].signal.aborted).toBe(true);
    await resolve(1, 'MSFT');
    await resolve(0, 'AAPL');
    expect(screen.queryAllByText('AAPL')).toHaveLength(0);
    expect(screen.getAllByText('MSFT').length).toBeGreaterThan(0);
    await type('T');
    await type('');
    expect(requests[2].signal.aborted).toBe(true);
    await resolve(2, 'TSLA');
    expect(screen.queryAllByText('TSLA')).toHaveLength(0);
  });
});

it('keeps the watchlist usable if storage writes fail', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => ({
    ok: true,
    json: async () => url.startsWith('/api/symbols')
      ? [{ symbol: 'AAPL', description: 'Apple' }]
      : { price: 100 },
  }));
  render(<WatchlistDialog isOpen onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'AAPL' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await act(async () => { fireEvent.click(screen.getByText('AAPL')); });
  expect(screen.getByRole('button', { name: /Remove AAPL/i })).toBeInTheDocument();
  expect(screen.getByText('AAPL')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
});
