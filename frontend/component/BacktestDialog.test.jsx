import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BacktestDialog from './BacktestDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('runs without browser storage and rejects fractional MA periods', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, json: async () => ({ metrics: {}, trades: [] }),
  });
  render(<BacktestDialog isOpen selectedSymbol="TEST" currentInterval="1d" onClose={() => {}} />);
  const period = screen.getAllByPlaceholderText('Period')[0];
  fireEvent.change(period, { target: { value: '20.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run Backtest' }));
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(period, { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run Backtest' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).strategyConfig.entry.right).toBe('MA_20');
});
