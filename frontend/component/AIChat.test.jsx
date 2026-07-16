import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';
import AIChat from './AIChat';
import TradeDialog from './TradeDialog';

function DraftHarness() {
  const [draft, setDraft] = useState(null);
  return (
    <>
      <AIChat
        stockSymbol="AAPL"
        stockData={[{ Date: '2026-01-02', Close: 101 }]}
        currentInterval="1d"
        fundamentals={null}
        aiPrediction={null}
        onReviewDraft={setDraft}
      />
      <TradeDialog
        isOpen={Boolean(draft)}
        onClose={() => setDraft(null)}
        stockSymbol={draft?.symbol}
        ibConnected
        draft={draft}
      />
    </>
  );
}

describe('AIChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens upward and sends only compact market data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/chat/models') {
        return {
          ok: true,
          json: async () => ({
            models: ['gpt-compatible-1', 'gpt-compatible-2'],
            defaultModel: 'gpt-compatible-1',
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'The latest close is 101.' }),
      };
    });
    const stockData = [
      {
        Date: '2026-01-02',
        Open: 99,
        High: 102,
        Low: 98,
        Close: 101,
        Volume: 1000,
        '10MA': 100,
        Label: 1,
        Price_Change_1D: 2,
      },
      { prediction: { recommendation: 'BUY' } },
    ];

    render(
      <I18nProvider>
        <AIChat
          stockSymbol="AAPL"
          stockData={stockData}
          currentInterval="1d"
          fundamentals={{ trailingPE: 25 }}
          aiPrediction={{ recommendation: 'BUY' }}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open AI chat' }));
    const modelSelect = await screen.findByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(modelSelect).toHaveValue('gpt-compatible-1'));
    fireEvent.change(modelSelect, { target: { value: 'gpt-compatible-2' } });
    fireEvent.change(screen.getByPlaceholderText('Ask about AAPL…'), {
      target: { value: 'What is the latest close?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('The latest close is 101.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const chatCall = fetchMock.mock.calls.find(([url]) => url === '/api/chat');
    const body = JSON.parse(chatCall[1].body);
    expect(body.model).toBe('gpt-compatible-2');
    expect(body.messages).toEqual([{ role: 'user', content: 'What is the latest close?' }]);
    expect(body.stockData).toEqual([{
      Date: '2026-01-02',
      Open: 99,
      High: 102,
      Low: 98,
      Close: 101,
      Volume: 1000,
      '10MA': 100,
    }]);
    expect(body.stockData[0]).not.toHaveProperty('Label');
  });

  it('opens the existing TradeDialog only when a validated draft is reviewed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/chat/models') {
        return {
          ok: true,
          json: async () => ({ models: ['deepseek-v4-flash'], defaultModel: 'deepseek-v4-flash' }),
        };
      }
      if (url === '/api/chat') {
        return {
          ok: true,
          json: async () => ({
            answer: 'I prepared a limit-order draft for review.',
            draftOrder: {
              symbol: 'MSFT',
              action: 'SELL',
              quantity: 3,
              orderType: 'LMT',
              limitPrice: 450.25,
              stopPrice: null,
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<I18nProvider><DraftHarness /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open AI chat' }));
    await screen.findByRole('combobox', { name: 'Model' });
    fireEvent.change(screen.getByPlaceholderText('Ask about AAPL…'), {
      target: { value: 'Draft a sell limit order.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('I prepared a limit-order draft for review.');
    expect(screen.queryByRole('dialog', { name: 'Trade MSFT' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/orders' && options?.method === 'POST'
    )).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Review draft' }));

    await screen.findByRole('dialog', { name: 'Trade MSFT' });
    expect(screen.getByRole('button', { name: 'SELL' })).toHaveClass('active');
    expect(screen.getByLabelText('Price (USD)')).toHaveValue(450.25);
    expect(screen.getByLabelText('Shares')).toHaveValue(3);
    expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/orders' && options?.method === 'POST'
    )).toBe(false);
  });
});
