import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';
import ScreenerDialog from './ScreenerDialog';

afterEach(() => vi.restoreAllMocks());

it('keeps conditions collapsed and shows matched history as selectable charts', async () => {
  const data = Array.from({ length: 140 }, (_, i) => ({
    Date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    Open: 100 + i + (i % 2 ? 1 : -1), High: 102 + i, Low: 98 + i, Close: 100 + i, '52week_low': 50, '52week_high': 240, '200MA': 70 + i,
  }));
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => data });
  const select = vi.fn();
  const { container } = render(<I18nProvider><ScreenerDialog isOpen onClose={() => {}} onStockSelect={select} /></I18nProvider>);
  expect(container.querySelector('details').open).toBe(false);
  fireEvent.change(screen.getByLabelText(/Symbols/), { target: { value: 'AAPL,MSFT' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run Screener' }));
  const first = await screen.findByRole('button', { name: 'Click to view AAPL chart' });
  const second = await screen.findByRole('button', { name: 'Click to view MSFT chart' });
  const chart = first.querySelector('svg');
  expect(chart).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  // Every daily wick and body remains present, batched into four paths.
  expect(chart.querySelectorAll('g path')).toHaveLength(4);
  for (const direction of ['up', 'down']) {
    const [wicks, bodies] = chart.querySelectorAll(`.screener-candle-${direction} path`);
    expect(wicks.getAttribute('d').match(/M/g)).toHaveLength(63);
    expect(bodies.getAttribute('d').match(/Z/g)).toHaveLength(63);
    expect(wicks.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  }
  expect(chart.querySelector('.screener-candle-up path').getAttribute('d')).toMatch(/V76M/);
  fireEvent.click(first);
  expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'AAPL', chartData: data }));
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'MSFT', chartData: data }));
  expect(document.activeElement).toBe(second);
});


it('allows condition changes and handles insufficient candle history', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [{
    Date: '2026-09-01', Open: 99, High: 101, Low: 98, Close: 100,
    '52week_low': 50, '52week_high': 110,
  }] });
  const { container } = render(<I18nProvider><ScreenerDialog isOpen onClose={() => {}} onStockSelect={() => {}} /></I18nProvider>);
  fireEvent.click(container.querySelector('summary'));
  expect(container.querySelector('details').open).toBe(true);
  const trend = screen.getAllByRole('checkbox')[2];
  fireEvent.click(trend);
  expect(trend).not.toBeChecked();
  expect(screen.getAllByRole('spinbutton')[2]).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Symbols/), { target: { value: 'AAPL' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run Screener' }));
  expect(await screen.findByText('Not enough price history to chart')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Click to view AAPL chart' })).toBeEnabled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
