import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nContext.jsx'
import TradeDialog from './TradeDialog'

it('defaults to the latest price on open, preserves edits, and prioritizes explicit draft prices', () => {
  const ticket = (props = {}) => <I18nProvider>
    <TradeDialog isOpen stockSymbol="AAPL" currentPrice={123.45} {...props} />
  </I18nProvider>
  const { rerender } = render(ticket())
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(123.45)
  fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '120' } })
  rerender(ticket({ currentPrice: 125 }))
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(120)
  rerender(ticket({ isOpen: false, currentPrice: 125 }))
  rerender(ticket({ currentPrice: 125 }))
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(125)
  rerender(ticket({ draft: { orderType: 'LMT', limitPrice: 110 } }))
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(110)
})

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('rejects fractional and unsafe quantities instead of truncating them', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, json: async () => ({ success: true, orderId: 123 }),
  });
  render(<TradeDialog isOpen ibConnected stockSymbol="TEST" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '100' } });
  const amount = screen.getByLabelText('Shares');
  for (const value of ['1.5', '9007199254740992', '0']) {
    fireEvent.change(amount, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /Place.*Order/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  }
  fireEvent.change(amount, { target: { value: '1e2' } });
  fireEvent.click(screen.getByRole('button', { name: /Place.*Order/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).quantity).toBe(100);
});

it('allows price-only changes to orders with fractional remaining shares', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, json: async () => ({ success: true, price: 101 }),
  });
  render(<TradeDialog isOpen ibConnected stockSymbol="TEST" onClose={() => {}}
    modification={{ order: { id: 'perm:123', action: 'BUY', remaining: 0.5, limitPrice: 100 } }} />);
  fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '101' } });
  fireEvent.click(screen.getByRole('button', { name: /Confirm Change/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ price: 101 });
});
