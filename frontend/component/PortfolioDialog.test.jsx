import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nContext.jsx';
import PortfolioDialog from './PortfolioDialog';

const NOW = new Date().toISOString();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function overview(overrides = {}) {
  return {
    connected: true,
    managedAccounts: ['DU1234567', 'DU7654321'],
    selectedAccount: 'DU1234567',
    accountType: 'PAPER',
    metrics: {
      USD: {
        NetLiquidation: 100000,
        BuyingPower: 50000,
        TotalCashValue: 20000,
        ExcessLiquidity: 25000,
        InitMarginReq: 8000,
        MaintMarginReq: 40000,
        GrossPositionValue: 60000,
      },
    },
    summaryReady: true,
    summaryError: null,
    summaryUpdatedAt: NOW,
    holdingsReady: true,
    holdingsError: null,
    holdingsUpdatedAt: NOW,
    baseCurrency: 'USD',
    grossMarketValue: 60000,
    unrealizedPnl: -100,
    holdings: [
      {
        id: 'DU1234567:TSLA', symbol: 'TSLA', quantity: -10, averageCost: 240,
        marketPrice: 250, marketValue: -25000, unrealizedPnl: -1000, weight: 41.7, currency: 'USD',
      },
      {
        id: 'DU1234567:MSFT', symbol: 'MSFT', quantity: 40, averageCost: 390,
        marketPrice: 400, marketValue: 16000, unrealizedPnl: 400, weight: 26.7, currency: 'USD',
      },
      {
        id: 'DU1234567:AAPL', symbol: 'AAPL', quantity: 50, averageCost: 140,
        marketPrice: 150, marketValue: 7500, unrealizedPnl: 500, weight: 12.5, currency: 'USD',
      },
    ],
    ...overrides,
  };
}

function mockOverview(payload) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const path = String(url);
    if (path.includes('/api/account/release')) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    const data = typeof payload === 'function' ? payload(path, options) : payload;
    return { ok: true, json: async () => data };
  });
}

function renderOverview(props = {}, payload = overview()) {
  const fetchMock = mockOverview(payload);
  const onStockSelect = vi.fn();
  const view = render(
    <I18nProvider>
      <PortfolioDialog isOpen isMaximized onStockSelect={onStockSelect} {...props} />
    </I18nProvider>,
  );
  return { ...view, fetchMock, onStockSelect };
}

it('masks account ids and shows broker freshness with KPI hierarchy', async () => {
  renderOverview();
  const selector = await screen.findByLabelText('Select account');
  expect(selector).toHaveValue('DU1234567');
  expect(selector).toHaveTextContent('••••4567');
  expect(selector).toHaveTextContent('••••4321');
  expect(selector).not.toHaveTextContent('DU1234567');
  expect(selector).not.toHaveTextContent('DU7654321');
  expect(screen.getByText('PAPER')).toBeInTheDocument();
  expect(screen.getByText('IB connected')).toBeInTheDocument();
  expect(screen.getByText(/Updated /)).toBeInTheDocument();
  expect(screen.getByText('Values update when IB pushes data; they are not a live stream.')).toBeInTheDocument();

  const kpis = [...document.querySelector('.account-kpi-strip').querySelectorAll('.account-kpi')]
    .map((node) => node.getAttribute('aria-label'));
  expect(kpis).toEqual([
    'Net liquidation',
    'Unrealized P&L',
    'Buying power',
    'Cash',
    'Excess liquidity',
    'Margin',
    'Gross position value',
  ]);
  expect(screen.getByLabelText('Margin')).toHaveTextContent(/Initial margin/);
  expect(screen.queryByText(/daily p&l/i)).not.toBeInTheDocument();
});

it('alerts only past 25% concentration, 20% excess-liquidity/NAV, and 50% maintenance-margin/NAV', async () => {
  renderOverview({}, overview({
    metrics: {
      USD: {
        NetLiquidation: 100000,
        ExcessLiquidity: 21000,
        MaintMarginReq: 49000,
        GrossPositionValue: 100000,
      },
    },
    holdings: [
      { id: '1', symbol: 'SAFE', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 25000, unrealizedPnl: 0, weight: 25, currency: 'USD' },
    ],
  }));
  await screen.findByText('No alerts');

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({
    metrics: {
      USD: {
        NetLiquidation: 100000,
        ExcessLiquidity: 19000,
        MaintMarginReq: 51000,
        GrossPositionValue: 100000,
      },
    },
    holdings: [
      { id: '1', symbol: 'RISKY', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 26000, unrealizedPnl: 0, weight: 26, currency: 'USD' },
    ],
  }));
  await screen.findByText('Concentration: RISKY');
  expect(screen.getByText('Low excess liquidity')).toBeInTheDocument();
  expect(screen.getByText('High maintenance margin')).toBeInTheDocument();
  expect(screen.getByLabelText('Alerts')).toBeInTheDocument();
});

it('marks data stale after 4 minutes while connected, and disconnects immediately without dropping the snapshot', async () => {
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
  renderOverview({}, overview({
    summaryUpdatedAt: isoAgo(3 * 60 * 1000 + 59 * 1000),
    holdingsUpdatedAt: isoAgo(3 * 60 * 1000 + 59 * 1000),
  }));
  await screen.findAllByText('TSLA');
  expect(screen.queryByText('Data is stale')).not.toBeInTheDocument();

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({
    summaryUpdatedAt: isoAgo(4 * 60 * 1000 + 1000),
    holdingsUpdatedAt: isoAgo(4 * 60 * 1000 + 1000),
  }));
  await screen.findByText('Data is stale');
  expect(screen.getByText('Last update was more than 4 minutes ago.')).toBeInTheDocument();
  expect(screen.getAllByText('TSLA')).not.toHaveLength(0);

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({
    connected: false,
    summaryUpdatedAt: isoAgo(1000),
    holdingsUpdatedAt: isoAgo(1000),
  }));
  expect(await screen.findByText('IB Gateway disconnected')).toBeInTheDocument();
  expect(screen.getByText('IB disconnected')).toBeInTheDocument();
  expect(screen.queryByText('Data is stale')).not.toBeInTheDocument();
  expect(screen.getAllByText('TSLA')).not.toHaveLength(0);
  expect(screen.getAllByText('AAPL')).not.toHaveLength(0);
});

it('ranks allocation by absolute market value, marks shorts, and keeps a stale snapshot after a failed refresh', async () => {
  const select = vi.fn();
  let calls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/api/account/release')) return { ok: true, json: async () => ({ ok: true }) };
    calls += 1;
    if (calls > 1) throw new Error('gateway timeout');
    return { ok: true, json: async () => overview() };
  });
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(NOW));
  render(
    <I18nProvider>
      <PortfolioDialog isOpen isMaximized onStockSelect={select} />
    </I18nProvider>,
  );

  const table = await screen.findByRole('table', { name: 'HOLDINGS' });
  expect(document.getElementById('portfolio-dialog-sidebar')).toHaveClass('account-overview-maximized');
  const holdingRows = [...table.querySelectorAll('tbody tr')];
  expect(holdingRows.map((row) => row.getAttribute('title'))).toEqual([
    'Load TSLA chart',
    'Load MSFT chart',
    'Load AAPL chart',
  ]);
  expect(holdingRows[0]).toHaveTextContent('Short');
  expect(table).toHaveTextContent('Market price');
  expect(table).toHaveTextContent('Market value');
  expect(table).toHaveTextContent('Unrealized P&L');

  const bars = screen.getAllByRole('button', { name: /of gross market value/ });
  expect(bars[0]).toHaveAccessibleName(/TSLA/);
  expect(bars[1]).toHaveAccessibleName(/MSFT/);
  expect(bars[2]).toHaveAccessibleName(/AAPL/);
  expect(bars[0]).toHaveClass('is-short');

  fireEvent.click(bars[2]);
  expect(select).toHaveBeenCalledWith({ symbol: 'AAPL' });
  fireEvent.click(holdingRows[2]);
  expect(select).toHaveBeenLastCalledWith({ symbol: 'AAPL' });
  fireEvent.click(holdingRows[1].querySelector('button'));
  expect(select).toHaveBeenLastCalledWith({ symbol: 'MSFT' });

  await act(async () => {
    vi.advanceTimersByTime(15000);
  });
  expect(screen.getAllByText('TSLA')).not.toHaveLength(0);
  expect(screen.getByText('Account refresh failed')).toBeInTheDocument();
  expect(screen.getByText('gateway timeout')).toBeInTheDocument();
  expect(screen.queryByText('Failed to load account overview')).not.toBeInTheDocument();
});

it('shows only holdings in compact mode and releases the holdings subscription on close', async () => {
  const fetchMock = mockOverview(overview());
  const { rerender } = render(
    <I18nProvider>
      <PortfolioDialog isOpen isMaximized onStockSelect={() => {}} />
    </I18nProvider>,
  );
  await screen.findAllByRole('button', { name: /of gross market value/ });
  rerender(
    <I18nProvider>
      <PortfolioDialog isOpen isMaximized={false} onStockSelect={() => {}} />
    </I18nProvider>,
  );
  expect(screen.queryByRole('button', { name: /of gross market value/ })).not.toBeInTheDocument();
  expect(document.getElementById('portfolio-dialog-sidebar')).not.toHaveClass('account-overview-maximized');
  expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'HOLDINGS' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Select account')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Net liquidation')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Alerts')).not.toBeInTheDocument();

  rerender(
    <I18nProvider>
      <PortfolioDialog isOpen={false} onStockSelect={() => {}} />
    </I18nProvider>,
  );
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith('/api/account/release', { method: 'POST' });
  });
});

it('renders Traditional Chinese copy for the overview chrome', async () => {
  localStorage.setItem('stockai-language', 'zh');
  renderOverview();
  expect(await screen.findByLabelText('選擇帳戶')).toBeInTheDocument();
  expect(screen.getByText('IB 已連線')).toBeInTheDocument();
  expect(screen.getByLabelText('淨清算價值')).toBeInTheDocument();
  expect(screen.getByLabelText('超額流動性')).toBeInTheDocument();
  expect(screen.getByLabelText('警示')).toBeInTheDocument();
  expect(screen.getAllByText('空頭')).not.toHaveLength(0);
});

it.skip('MANUAL-AO-01 responsive layout', () => {
  // ID: MANUAL-AO-01
  // Scenario: Account Overview at desktop and mobile widths.
  // Prerequisites: frontend + backend running; IB overview payload with holdings.
  // Steps: open portfolio panel; resize 1280px and 375px; maximize then restore.
  // Expected: extra columns stay in .col-extra; bars only when maximized; selector, KPIs, alerts remain usable; no overlap.
});

it.skip('MANUAL-AO-02 app maximize control', () => {
  // ID: MANUAL-AO-02
  // Scenario: Maximize/restore lives on App account-panel chrome, not inside PortfolioDialog.
  // Prerequisites: full App shell; panel open.
  // Steps: click Maximize account panel; confirm allocation bars; click Restore account panel.
  // Expected: aria-label swaps Maximize/Restore; PortfolioDialog gets isMaximized; holdings stay.
});
