import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        GrossPositionValue: 48500,
      },
    },
    summaryReady: true,
    summaryError: null,
    summaryUpdatedAt: NOW,
    holdingsReady: true,
    holdingsError: null,
    holdingsUpdatedAt: NOW,
    baseCurrency: 'USD',
    grossMarketValue: 48500,
    unrealizedPnl: -100,
    // Backend-consistent: |marketValue| sums to grossMarketValue and weight = |marketValue| / grossMarketValue * 100.
    holdings: [
      {
        id: 'DU1234567:TSLA', symbol: 'TSLA', quantity: -100, averageCost: 240,
        marketPrice: 250, marketValue: -25000, unrealizedPnl: -1000, weight: (25000 / 48500) * 100, currency: 'USD',
      },
      {
        id: 'DU1234567:MSFT', symbol: 'MSFT', quantity: 40, averageCost: 390,
        marketPrice: 400, marketValue: 16000, unrealizedPnl: 400, weight: (16000 / 48500) * 100, currency: 'USD',
      },
      {
        id: 'DU1234567:AAPL', symbol: 'AAPL', quantity: 50, averageCost: 140,
        marketPrice: 150, marketValue: 7500, unrealizedPnl: 500, weight: (7500 / 48500) * 100, currency: 'USD',
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

it('alerts only past 25% cash-inclusive allocation, 20% excess-liquidity/NAV, and 50% maintenance-margin/NAV', async () => {
  renderOverview({}, overview({
    grossMarketValue: 25000,
    metrics: {
      USD: {
        NetLiquidation: 100000,
        ExcessLiquidity: 21000,
        MaintMarginReq: 49000,
        GrossPositionValue: 25000,
        TotalCashValue: 75000,
      },
    },
    holdings: [
      { id: '1', symbol: 'SAFE', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 25000, unrealizedPnl: 0, weight: 100, currency: 'USD' },
    ],
  }));
  await screen.findByText('No alerts');

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({
    grossMarketValue: 26000,
    metrics: {
      USD: {
        NetLiquidation: 100000,
        ExcessLiquidity: 19000,
        MaintMarginReq: 51000,
        GrossPositionValue: 26000,
        TotalCashValue: 74000,
      },
    },
    holdings: [
      { id: '1', symbol: 'RISKY', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 26000, unrealizedPnl: 0, weight: 100, currency: 'USD' },
    ],
  }));
  await screen.findByText('Concentration: RISKY');
  expect(screen.getByText(/RISKY is 26.0% of portfolio allocation/)).toBeInTheDocument();
  expect(screen.getByText('Low excess liquidity')).toBeInTheDocument();
  expect(screen.getByText('High maintenance margin')).toBeInTheDocument();
  expect(screen.getByLabelText('Alerts')).toBeInTheDocument();
});

it('does not alert on an exact 25% share nudged above the limit by float noise', async () => {
  renderOverview({}, overview({
    grossMarketValue: 52000,
    metrics: {
      USD: { NetLiquidation: 160000, TotalCashValue: 108000, GrossPositionValue: 52000 },
    },
    holdings: [
      { id: 'big', symbol: 'BIG', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 40000, unrealizedPnl: 0, weight: (40000 / 52000) * 100, currency: 'USD' },
      { id: 'small', symbol: 'SMALL', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 12000, unrealizedPnl: 0, weight: (12000 / 52000) * 100, currency: 'USD' },
    ],
  }));
  const allocation = await screen.findByRole('region', { name: 'Portfolio allocation' });
  // BIG's true share is exactly 25% (40000 / 160000); the double math yields 25.000000000000007.
  const legend = within(allocation).getAllByRole('listitem').map((item) => item.textContent);
  expect(legend.find((item) => item.includes('BIG'))).toMatch(/25\.0%/);
  expect(screen.queryByText(/Concentration:/)).not.toBeInTheDocument();
  expect(await screen.findByText('No alerts')).toBeInTheDocument();
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

it('keeps short allocation static and preserves the stale snapshot after a failed refresh', async () => {
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
  expect(table).toHaveTextContent('Allocation');
  expect(table).not.toHaveTextContent('Weight');

  const allocation = screen.getByRole('region', { name: 'Portfolio allocation' });
  expect(within(allocation).queryAllByRole('button')).toHaveLength(0);
  expect(within(allocation).queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /of gross market value/ })).not.toBeInTheDocument();
  // Display-only: no donut or legend element may load a chart.
  for (const node of [allocation, ...allocation.querySelectorAll('*')]) fireEvent.click(node);
  expect(select).not.toHaveBeenCalled();

  fireEvent.click(holdingRows[2]);
  expect(select).toHaveBeenCalledWith({ symbol: 'AAPL' });
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
  await screen.findByRole('region', { name: 'Portfolio allocation' });
  rerender(
    <I18nProvider>
      <PortfolioDialog isOpen isMaximized={false} onStockSelect={() => {}} />
    </I18nProvider>,
  );
  expect(screen.queryByRole('region', { name: 'Portfolio allocation' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('region', { name: '投資組合配置' })).toBeInTheDocument();
  expect(screen.getByText('毛曝險 + 現金')).toBeInTheDocument();
  expect(screen.getAllByText('空頭')).not.toHaveLength(0);
});

it('builds cash-inclusive donut slices, groups tiny positions, and matches table allocation', async () => {
  renderOverview();
  const allocation = await screen.findByRole('region', { name: 'Portfolio allocation' });
  expect(screen.getByText('Gross exposure + cash')).toBeInTheDocument();
  const donut = within(allocation).getByRole('img');
  // Center and accessible name must both carry the represented total (20000 cash + 48500 positions).
  expect(donut.textContent.replace(/[^0-9]/g, '')).toContain('68500');
  expect(donut).toHaveAccessibleName(/TSLA 36\.5%/);
  expect(donut.getAttribute('aria-label').replace(/[^0-9]/g, '')).toContain('68500');
  expect(within(allocation).queryAllByRole('button')).toHaveLength(0);
  // Connectors must leave the ring edge, elbow outside it, and land on the Y its callout is pinned to.
  const points = allocation.querySelector('polyline[data-slice="DU1234567:TSLA"]')
    .getAttribute('points')
    .split(' ')
    .map((point) => point.split(',').map(Number));
  expect(points).toHaveLength(3);
  expect(Math.hypot(points[0][0] - 74, points[0][1] - 88)).toBeCloseTo(74);
  expect(Math.hypot(points[1][0] - 74, points[1][1] - 88)).toBeCloseTo(88);
  expect(points[2][0]).toBeGreaterThan(74);
  const calloutTop = within(allocation).getByText('TSLA').closest('.account-allocation-callout').style.top;
  expect(Number.parseFloat(calloutTop)).toBeCloseTo(points[2][1]);
  expect(allocation.querySelector('.account-allocation-body')).toHaveClass('account-allocation-body--leadered');

  const legend = within(allocation).getAllByRole('listitem').map((item) => item.textContent);
  expect(legend[0]).toMatch(/TSLA/);
  expect(legend[0]).toMatch(/Short/);
  expect(legend[0]).toMatch(/36\.5%/);
  // Shorts show absolute market value, so the signed table value must not leak into the legend.
  expect(legend[0]).not.toMatch(/[-−]/);
  expect(legend[0].replace(/[^0-9]/g, '')).toContain('25000');
  expect(legend[1]).toMatch(/Cash/);
  expect(legend[1]).toMatch(/29\.2%/);
  expect(legend[2]).toMatch(/MSFT/);
  expect(legend[2]).toMatch(/23\.4%/);
  expect(legend[3]).toMatch(/AAPL/);
  expect(legend[3]).toMatch(/10\.9%/);
  expect(legend.join(' ')).not.toMatch(/Other/);

  const table = screen.getByRole('table', { name: 'HOLDINGS' });
  const rows = [...table.querySelectorAll('tbody tr')];
  const allocationIndex = within(table).getAllByRole('columnheader')
    .findIndex((header) => header.textContent === 'Allocation');
  expect(allocationIndex).toBeGreaterThan(-1);
  const percentOf = (text) => text.match(/\d+\.\d%/)[0];
  // Legend and table must show exactly the same percentage, not merely the same rounded value.
  ['TSLA', 'MSFT', 'AAPL'].forEach((symbol, index) => {
    const legendItem = legend.find((item) => item.includes(symbol));
    const cell = within(rows[index]).getAllByRole('cell')[allocationIndex];
    expect(percentOf(legendItem)).toBe(percentOf(cell.textContent));
  });

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({
    grossMarketValue: 100000,
    metrics: {
      USD: {
        NetLiquidation: 100000,
        TotalCashValue: -5000,
        GrossPositionValue: 100000,
      },
    },
    holdings: [
      { id: 'big', symbol: 'BIG', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 98500, unrealizedPnl: 0, weight: 98.5, currency: 'USD' },
      { id: 'tiny', symbol: 'TINY', quantity: -2, averageCost: 1, marketPrice: 1, marketValue: -1500, unrealizedPnl: 0, weight: 1.5, currency: 'USD' },
    ],
  }));
  const grouped = await screen.findByRole('region', { name: 'Portfolio allocation' });
  const groupedLegend = within(grouped).getAllByRole('listitem').map((item) => item.textContent);
  expect(groupedLegend).toHaveLength(2);
  expect(groupedLegend[0]).toMatch(/BIG/);
  expect(groupedLegend[0]).toMatch(/98\.5%/);
  expect(groupedLegend[1]).toMatch(/Other/);
  expect(groupedLegend[1]).toMatch(/1\.5%/);
  expect(within(grouped).queryByText('Cash')).not.toBeInTheDocument();
  expect(groupedLegend[1]).not.toMatch(/TINY/);
  expect(within(grouped).queryByText('Short')).not.toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'HOLDINGS' })).toHaveTextContent('1.5%');
});

it('drops leader lines for a crowded donut whose labels cannot sit beside their slices', async () => {
  const tiny = (n) => ({
    id: `t${n}`,
    symbol: `T${n}`,
    quantity: 1,
    averageCost: 1,
    marketPrice: 1,
    marketValue: 2000,
    unrealizedPnl: 0,
    weight: (2000 / 100000) * 100,
    currency: 'USD',
  });
  renderOverview({}, overview({
    grossMarketValue: 100000,
    metrics: {
      USD: { NetLiquidation: 100000, TotalCashValue: 0, GrossPositionValue: 100000 },
    },
    holdings: [
      {
        id: 'lead', symbol: 'LEAD', quantity: 1, averageCost: 1, marketPrice: 1,
        marketValue: 86000, unrealizedPnl: 0, weight: 86, currency: 'USD',
      },
      ...[1, 2, 3, 4, 5, 6, 7].map(tiny),
    ],
  }));
  const allocation = await screen.findByRole('region', { name: 'Portfolio allocation' });
  // 86% + seven 2% slices push every small label far from its own wedge, and the leader diagonals
  // would then cross each other, so the chart must fall back to the stacked legend.
  expect(allocation.querySelector('.account-allocation-body')).not.toHaveClass('account-allocation-body--leadered');
  expect(allocation.querySelectorAll('polyline')).toHaveLength(0);
  expect(within(allocation).getAllByRole('listitem')).toHaveLength(8);
  expect(within(allocation).getByText('T7')).toBeInTheDocument();
});

it('keeps 2% positions out of Other at the threshold and under float noise', async () => {
  renderOverview({}, overview({
    grossMarketValue: 100000,
    metrics: {
      USD: {
        NetLiquidation: 100000,
        TotalCashValue: 0,
        GrossPositionValue: 100000,
      },
    },
    holdings: [
      { id: 'fill', symbol: 'FILL', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 96500, unrealizedPnl: 0, weight: 96.5, currency: 'USD' },
      { id: 'edge', symbol: 'EDGE', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 2000, unrealizedPnl: 0, weight: 2, currency: 'USD' },
      { id: 'tiny', symbol: 'TINY', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 1500, unrealizedPnl: 0, weight: 1.5, currency: 'USD' },
    ],
  }));
  const allocation = await screen.findByRole('region', { name: 'Portfolio allocation' });
  const legend = within(allocation).getAllByRole('listitem').map((item) => item.textContent);

  expect(legend).toHaveLength(3);
  expect(legend[0]).toMatch(/FILL/);
  expect(legend[0]).toMatch(/96\.5%/);
  expect(legend[1]).toMatch(/EDGE/);
  expect(legend[1]).toMatch(/2\.0%/);
  expect(legend[2]).toMatch(/Other/);
  expect(legend[2]).toMatch(/1\.5%/);
  expect(legend[2]).not.toMatch(/TINY/);
  expect(within(allocation).queryByText('Cash')).not.toBeInTheDocument();

  cleanup();
  vi.restoreAllMocks();
  // True share is exactly 2% (3000 / 150000) but the double math yields 1.9999999999999998,
  // so it must still be its own slice rather than falling into Other.
  renderOverview({}, overview({
    grossMarketValue: 51000,
    metrics: {
      USD: {
        NetLiquidation: 150000,
        TotalCashValue: 99000,
        GrossPositionValue: 51000,
      },
    },
    holdings: [
      { id: 'fill', symbol: 'FILL', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 48000, unrealizedPnl: 0, weight: (48000 / 51000) * 100, currency: 'USD' },
      { id: 'edge', symbol: 'EDGE', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 3000, unrealizedPnl: 0, weight: (3000 / 51000) * 100, currency: 'USD' },
    ],
  }));
  const noisy = await screen.findByRole('region', { name: 'Portfolio allocation' });
  const noisyLegend = within(noisy).getAllByRole('listitem').map((item) => item.textContent);
  expect(noisyLegend.map((item) => item.match(/[A-Za-z]+/)[0])).toEqual(['Cash', 'FILL', 'EDGE']);
  expect(noisyLegend[2]).toMatch(/2\.0%/);
  expect(noisy).not.toHaveTextContent('Other');
});

it('keeps each holding id color stable when positions swap rank', async () => {
  const swatchColor = (scope, symbol) => within(scope).getAllByRole('listitem')
    .find((item) => item.textContent.includes(symbol))
    .querySelector('[aria-hidden="true"]').style.background;
  const position = (id, symbol, value) => ({
    id,
    symbol,
    quantity: 1,
    averageCost: 1,
    marketPrice: value,
    marketValue: value,
    unrealizedPnl: 0,
    weight: (value / 30000) * 100,
    currency: 'USD',
  });
  const payload = (holdings) => overview({
    grossMarketValue: 30000,
    metrics: {
      USD: { NetLiquidation: 100000, TotalCashValue: 0, GrossPositionValue: 30000 },
    },
    holdings,
  });

  renderOverview({}, payload([position('aaa', 'AAA', 20000), position('bbb', 'BBB', 10000)]));
  const first = await screen.findByRole('region', { name: 'Portfolio allocation' });
  const before = {
    lead: within(first).getAllByRole('listitem')[0].textContent,
    aaa: swatchColor(first, 'AAA'),
    bbb: swatchColor(first, 'BBB'),
  };
  expect(before.aaa).toMatch(/^var\(--/);
  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, payload([position('aaa', 'AAA', 10000), position('bbb', 'BBB', 20000)]));
  const second = await screen.findByRole('region', { name: 'Portfolio allocation' });
  const after = {
    lead: within(second).getAllByRole('listitem')[0].textContent,
    aaa: swatchColor(second, 'AAA'),
    bbb: swatchColor(second, 'BBB'),
  };

  // Same ids with swapped magnitudes: the leading position changes, the colors must follow the id.
  expect(before.lead).toMatch(/AAA/);
  expect(after.lead).toMatch(/BBB/);
  expect(after.aaa).toBe(before.aaa);
  expect(after.bbb).toBe(before.bbb);
});

it('shows Allocation unavailable for empty pending holdings, then an all-cash donut', async () => {
  const allCash = {
    holdings: [],
    holdingsReady: false,
    grossMarketValue: 0,
    metrics: {
      USD: { NetLiquidation: 100000, TotalCashValue: 20000, GrossPositionValue: 0 },
    },
  };
  renderOverview({}, overview(allCash));
  const pending = await screen.findByRole('region', { name: 'Portfolio allocation' });
  // Empty holdings with positive cash are ambiguous until the holdings subscription reports ready.
  expect(pending).toHaveTextContent('Allocation unavailable');
  expect(within(pending).queryByRole('img')).not.toBeInTheDocument();
  expect(within(pending).queryAllByRole('listitem')).toHaveLength(0);

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({ ...allCash, holdingsReady: true }));
  const ready = await screen.findByRole('region', { name: 'Portfolio allocation' });
  const donut = within(ready).getByRole('img');
  expect(donut).toHaveAccessibleName(/Cash 100\.0%/);
  expect(donut.getAttribute('aria-label').replace(/[^0-9]/g, '')).toContain('20000');
  const legend = within(ready).getAllByRole('listitem').map((item) => item.textContent);
  expect(legend).toHaveLength(1);
  expect(legend[0]).toMatch(/Cash/);
  expect(legend[0]).toMatch(/100\.0%/);
});

it('keeps the cached allocation while populated holdings are not yet confirmed ready', async () => {
  renderOverview({}, overview({ holdingsReady: false }));
  const allocation = await screen.findByRole('region', { name: 'Portfolio allocation' });
  // Populated holdings stay renderable from cache; readiness only gates the empty-pending case.
  expect(within(allocation).getByRole('img')).toBeInTheDocument();
  const legend = within(allocation).getAllByRole('listitem').map((item) => item.textContent);
  expect(legend[0]).toMatch(/TSLA/);
  expect(legend[0]).toMatch(/36\.5%/);
  expect(legend[1]).toMatch(/Cash/);
  expect(legend[1]).toMatch(/29\.2%/);
  expect(legend[2]).toMatch(/MSFT/);
  expect(legend[2]).toMatch(/23\.4%/);
  expect(legend[3]).toMatch(/AAPL/);
  expect(legend[3]).toMatch(/10\.9%/);

  const table = screen.getByRole('table', { name: 'HOLDINGS' });
  const rows = [...table.querySelectorAll('tbody tr')];
  const allocationIndex = within(table).getAllByRole('columnheader')
    .findIndex((header) => header.textContent === 'Allocation');
  const percentOf = (text) => text.match(/\d+\.\d%/)[0];
  ['TSLA', 'MSFT', 'AAPL'].forEach((symbol, index) => {
    const legendItem = legend.find((item) => item.includes(symbol));
    const cell = within(rows[index]).getAllByRole('cell')[allocationIndex];
    expect(percentOf(legendItem)).toBe(percentOf(cell.textContent));
  });
});

it('shows Allocation unavailable when cash is missing or non-finite', async () => {
  renderOverview({}, overview({
    metrics: {
      USD: { NetLiquidation: 100000, GrossPositionValue: 48500 },
    },
  }));
  expect(await screen.findByRole('region', { name: 'Portfolio allocation' })).toHaveTextContent('Allocation unavailable');

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({
    metrics: {
      USD: { NetLiquidation: 100000, TotalCashValue: null, GrossPositionValue: 48500 },
    },
  }));
  expect(await screen.findByRole('region', { name: 'Portfolio allocation' })).toHaveTextContent('Allocation unavailable');
});

it('shows Allocation unavailable when the metric currency differs from the base currency', async () => {
  renderOverview({}, overview({ baseCurrency: 'EUR' }));
  const allocation = await screen.findByRole('region', { name: 'Portfolio allocation' });
  expect(allocation).toHaveTextContent('Allocation unavailable');
  expect(within(allocation).queryByRole('img')).not.toBeInTheDocument();
  // Unavailable allocation must not produce cash-inclusive concentration warnings either.
  expect(screen.queryByText(/Concentration:/)).not.toBeInTheDocument();
});

it('hides the donut and concentration warnings when a weight is missing or the represented total is zero', async () => {
  renderOverview({}, overview({
    grossMarketValue: 100000,
    metrics: {
      USD: { NetLiquidation: 100000, TotalCashValue: 20000, GrossPositionValue: 100000 },
    },
    holdings: [
      { id: '1', symbol: 'HUGE', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 90000, unrealizedPnl: 0, weight: 90, currency: 'USD' },
      { id: '2', symbol: 'AAPL', quantity: 1, averageCost: 1, marketPrice: 1, marketValue: 100, unrealizedPnl: 0, currency: 'EUR' },
    ],
  }));
  const unavailable = await screen.findByRole('region', { name: 'Portfolio allocation' });
  expect(unavailable).toHaveTextContent('Allocation unavailable');
  expect(within(unavailable).queryByRole('img')).not.toBeInTheDocument();
  expect(within(unavailable).queryAllByRole('listitem')).toHaveLength(0);
  // Without an allocation there is no cash-inclusive percentage, so HUGE must not alert.
  expect(screen.queryByText(/Concentration:/)).not.toBeInTheDocument();

  const table = screen.getByRole('table', { name: 'HOLDINGS' });
  const allocationIndex = within(table).getAllByRole('columnheader')
    .findIndex((header) => header.textContent === 'Allocation');
  expect(within(within(table).getByRole('row', { name: /AAPL/ })).getAllByRole('cell')[allocationIndex])
    .toHaveTextContent('—');

  cleanup();
  vi.restoreAllMocks();
  renderOverview({}, overview({
    grossMarketValue: 0,
    metrics: {
      USD: {
        NetLiquidation: 100000,
        TotalCashValue: 0,
        GrossPositionValue: 0,
      },
    },
    holdings: [],
  }));
  const empty = await screen.findByRole('region', { name: 'Portfolio allocation' });
  expect(empty).toHaveTextContent('No allocation data');
  expect(within(empty).queryByRole('img')).not.toBeInTheDocument();
});

it.skip('MANUAL-AO-01 responsive layout', () => {
  // ID: MANUAL-AO-01
  // Scenario: Account Overview at desktop and mobile widths.
  // Prerequisites: frontend + backend running; IB overview payload with holdings.
  // Steps: open portfolio panel; resize 1280px and 375px; maximize then restore.
  // Expected: extra columns stay in .col-extra; donut only when maximized; selector, KPIs, alerts remain usable; no overlap.
});

it.skip('MANUAL-AO-02 app maximize control', () => {
  // ID: MANUAL-AO-02
  // Scenario: Maximize/restore lives on App account-panel chrome, not inside PortfolioDialog.
  // Prerequisites: full App shell; panel open.
  // Steps: click Maximize account panel; confirm allocation donut; click Restore account panel.
  // Expected: aria-label swaps Maximize/Restore; PortfolioDialog gets isMaximized; holdings stay.
});
