import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import usePaperAccount from './usePaperAccount';

function Harness() {
  const paper = usePaperAccount();
  const [message, setMessage] = useState('');
  const submit = (action) => paper.submit({
    symbol: 'AAA', action, quantity: 1, price: 100, tif: 'GTC',
  }).then(() => setMessage('submitted')).catch((error) => setMessage(error.message));
  return <>
    <span data-testid="fatal-error">{paper.error}</span>
    <span data-testid="order-count">{paper.openOrders.length}</span>
    <span>{message}</span>
    <button disabled={!paper.canTrade} onClick={() => submit('SELL')}>Invalid sell</button>
    <button disabled={!paper.canTrade} onClick={() => submit('BUY')}>Valid buy</button>
  </>;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('navigator', {
    userAgent: '',
    locks: { request: async (_name, _options, callback) => callback() },
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ price: 200 }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps trading enabled after an order validation rejection', async () => {
  render(<Harness />);
  const invalid = await screen.findByRole('button', { name: 'Invalid sell' });
  await waitFor(() => expect(invalid).toBeEnabled());

  fireEvent.click(invalid);
  await screen.findByText('Insufficient available shares');
  expect(screen.getByTestId('fatal-error')).toHaveTextContent('');
  expect(screen.getByRole('button', { name: 'Valid buy' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Valid buy' }));
  await screen.findByText('submitted');
  expect(screen.getByTestId('order-count')).toHaveTextContent('1');
});
