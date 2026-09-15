import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
import './PortfolioDialog.css';

// Read-only account overview. Display selection never changes order routing.
const OVERVIEW_POLL_MS = 15000;
const STALE_AFTER_MINUTES = 4;
const STALE_AFTER_MS = STALE_AFTER_MINUTES * 60 * 1000;
const CONCENTRATION_LIMIT_PCT = 25;
const EXCESS_LIQUIDITY_MIN_PCT = 20;
const MAINT_MARGIN_MAX_PCT = 50;
const NO_HOLDINGS = [];

function maskAccountId(account) {
  const value = String(account ?? '').trim();
  return value ? `${'•'.repeat(4)}${value.slice(-4)}` : '—';
}

function pickMetricCurrency(metrics, baseCurrency) {
  if (!metrics) return '';

  if (baseCurrency && metrics[baseCurrency]) return baseCurrency;

  const currencies = Object.keys(metrics).filter(
    (currency) => currency && Number.isFinite(metrics[currency]?.NetLiquidation),
  );

  if (currencies.includes('USD')) return 'USD';
  return currencies.sort()[0] ?? Object.keys(metrics).find(Boolean) ?? '';
}

function formatCurrency(value, currency) {
  if (!Number.isFinite(value)) return '—';

  const code = /^[A-Z]{3}$/.test(String(currency ?? '')) ? currency : null;
  if (!code) return `${formatNumber(value)}${currency ? ` ${currency}` : ''}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatQuantity(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function formatClockTime(value, language) {
  if (value == null || value === '') return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleTimeString(language === 'zh' ? 'zh-TW' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function latestTimestamp(timestamps) {
  const values = timestamps
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  return values.length ? Math.max(...values) : null;
}

function AccountOverview({ isOpen, isMaximized, onStockSelect }) {
  const { t, language } = useTranslation();
  const [data, setData] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [checkedAt, setCheckedAt] = useState(Date.now());
  const releaseTimerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const controller = new AbortController();
    let active = true;
    let timer = null;

    const load = async (isInitial) => {
      setCheckedAt(Date.now());
      if (isInitial) {
        setLoading(true);
        setError(null);
      }

      try {
        const query = selectedAccount ? `?account=${encodeURIComponent(selectedAccount)}` : '';
        const response = await fetch(`/api/account/overview${query}`, { signal: controller.signal });
        const payload = await response.json();

        if (!active) return;

        if (!response.ok) {
          if (response.status === 400 && selectedAccount) setSelectedAccount(null);
          throw new Error(payload?.error || t('failedLoadAccountOverview'));
        }

        setData(payload);
        setError(null);

        if (payload?.selectedAccount && payload.selectedAccount !== selectedAccount) {
          setSelectedAccount(payload.selectedAccount);
        }
      } catch (fetchError) {
        if (active && fetchError.name !== 'AbortError') {
          setError(fetchError.message || t('failedLoadAccountOverview'));
        }
      } finally {
        if (active && isInitial) setLoading(false);
      }
    };

    load(true);
    timer = setInterval(() => load(false), OVERVIEW_POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      controller.abort();
    };
  }, [isOpen, selectedAccount, t]);

  useEffect(() => {
    if (!isOpen) return undefined;

    // Explicit cleanup: stop the selected-account holdings subscription. The
    // release is deferred so a StrictMode remount (immediate re-registration)
    // cancels it instead of killing a fresh subscription.
    clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = null;

    return () => {
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null;
        fetch('/api/account/release', { method: 'POST' }).catch(() => {});
      }, 0);
    };
  }, [isOpen]);

  const metrics = data?.metrics;
  const currency = useMemo(() => pickMetricCurrency(metrics, data?.baseCurrency), [data?.baseCurrency, metrics]);
  const holdings = data?.holdings ?? NO_HOLDINGS;
  const accounts = data?.managedAccounts ?? [];
  const accountType = data?.accountType;

  const metric = useCallback((tag) => {
    const value = metrics?.[currency]?.[tag];
    return Number.isFinite(value) ? value : null;
  }, [metrics, currency]);

  const nav = metric('NetLiquidation');
  const unrealizedPnl = Number.isFinite(data?.unrealizedPnl) ? data.unrealizedPnl : null;

  const lastUpdated = latestTimestamp([data?.summaryUpdatedAt, data?.holdingsUpdatedAt]);
  const syncError = error || data?.summaryError || data?.holdingsError;
  const stale = Boolean(data?.connected) && [
    data?.summaryUpdatedAt,
    holdings.length || data?.holdingsReady ? data?.holdingsUpdatedAt : null,
  ].some((timestamp) => timestamp && checkedAt - Date.parse(timestamp) > STALE_AFTER_MS);

  const alerts = useMemo(() => {
    if (!data) return [];

    const list = [];

    if (!data.connected) {
      list.push({
        id: 'disconnected',
        tone: 'critical',
        label: t('alertDisconnected'),
        detail: t('alertDisconnectedDetail'),
      });
    }

    if (stale) {
      list.push({
        id: 'stale',
        tone: 'warning',
        label: t('alertStale'),
        detail: t('alertStaleDetail', { minutes: STALE_AFTER_MINUTES }),
      });
    }

    if (syncError) {
      list.push({
        id: 'refresh-failed',
        tone: 'warning',
        label: t('alertRefreshFailed'),
        detail: syncError,
      });
    }

    const maintMargin = metric('MaintMarginReq');
    if (
      Number.isFinite(nav) && nav > 0
      && Number.isFinite(maintMargin) && maintMargin > (MAINT_MARGIN_MAX_PCT / 100) * nav
    ) {
      list.push({
        id: 'maintenance-margin',
        tone: 'warning',
        label: t('alertMaintMargin'),
        detail: t('alertMaintMarginDetail', {
          percent: ((maintMargin / nav) * 100).toFixed(1),
          limit: MAINT_MARGIN_MAX_PCT,
        }),
      });
    }

    const excessLiquidity = metric('ExcessLiquidity');
    if (
      Number.isFinite(nav) && nav > 0
      && Number.isFinite(excessLiquidity) && excessLiquidity < (EXCESS_LIQUIDITY_MIN_PCT / 100) * nav
    ) {
      list.push({
        id: 'excess-liquidity',
        tone: 'warning',
        label: t('alertExcessLiquidity'),
        detail: t('alertExcessLiquidityDetail', {
          percent: ((excessLiquidity / nav) * 100).toFixed(1),
          limit: EXCESS_LIQUIDITY_MIN_PCT,
        }),
      });
    }

    for (const holding of holdings) {
      if (!Number.isFinite(holding.weight) || holding.weight <= CONCENTRATION_LIMIT_PCT) continue;

      list.push({
        id: `concentration-${holding.id ?? holding.symbol}`,
        tone: 'warning',
        label: t('alertConcentration', { symbol: holding.symbol }),
        detail: t('alertConcentrationDetail', {
          symbol: holding.symbol,
          percent: holding.weight.toFixed(1),
          limit: CONCENTRATION_LIMIT_PCT,
        }),
      });
    }

    return list;
  }, [data, holdings, metric, nav, stale, syncError, t]);

  const maxWeight = holdings.reduce(
    (max, row) => (Number.isFinite(row.weight) ? Math.max(max, Math.abs(row.weight)) : max),
    0,
  );
  const weightedHoldings = holdings.filter((row) => Number.isFinite(row.weight));

  const hasSnapshot = Boolean(
    data && (
      data.connected === false
      || data.selectedAccount
      || accounts.length > 0
      || holdings.length > 0
      || (metrics && Object.keys(metrics).length > 0)
    ),
  );

  const handleSelectSymbol = (row) => {
    if (!row?.symbol || !onStockSelect) return;
    onStockSelect({ symbol: row.symbol });
  };

  const kpi = [
    { id: 'net-liquidation', tag: 'NetLiquidation', label: t('netLiquidation'), timestamp: data?.summaryUpdatedAt },
    {
      id: 'unrealized-pnl',
      label: t('unrealizedPnl'),
      value: unrealizedPnl,
      timestamp: data?.holdingsUpdatedAt,
    },
    { id: 'buying-power', tag: 'BuyingPower', label: t('buyingPower'), timestamp: data?.summaryUpdatedAt },
    { id: 'cash', tag: 'TotalCashValue', label: t('cashBalance'), timestamp: data?.summaryUpdatedAt },
    { id: 'excess-liquidity', tag: 'ExcessLiquidity', label: t('excessLiquidity'), timestamp: data?.summaryUpdatedAt },
    { id: 'margin', tag: 'MaintMarginReq', label: t('marginRequirement'), timestamp: data?.summaryUpdatedAt },
  ];

  const freshnessLabel = lastUpdated
    ? t('dataUpdatedAt', { time: formatClockTime(lastUpdated, language) })
    : null;

  return (
    <div
      id="portfolio-dialog-sidebar"
      role="tabpanel"
      aria-labelledby="portfolio-tab"
      hidden={!isOpen}
      className={isMaximized ? 'account-overview-maximized' : undefined}
    >
      {loading && !hasSnapshot && (
        <div id="portfolio-loading-state">
          <span className="portfolio-spinner" />
          <span>{t('loadingAccountOverview')}</span>
        </div>
      )}

      {error && !hasSnapshot && (
        <div id="portfolio-error-state" role="alert">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {!loading && !error && !hasSnapshot && (
        <div id="portfolio-empty-state">
          <div className="portfolio-empty-icon">
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <span className="portfolio-empty-title">{t('noIBPositions')}</span>
          <span className="portfolio-empty-sub">{t('makeSureIB')}</span>
        </div>
      )}

      {hasSnapshot && (
        <div id="account-overview">
          {isMaximized && (
            <>
              <div className="account-overview-header">
            <div className="account-selector">
              {accounts.length > 1 ? (
                <>
                  <label className="account-overview-sr" htmlFor="account-selector">{t('selectAccount')}</label>
                  <select
                    id="account-selector"
                    className="account-selector-select"
                    value={selectedAccount ?? data.selectedAccount ?? ''}
                    onChange={(event) => {
                      setData(null);
                      setSelectedAccount(event.target.value);
                    }}
                  >
                    {accounts.map((account) => (
                      <option key={account} value={account}>{maskAccountId(account)}</option>
                    ))}
                  </select>
                </>
              ) : (
                <span
                  className="account-selector-masked"
                  aria-label={`${t('selectAccount')}: ${maskAccountId(data.selectedAccount)}`}
                >
                  {maskAccountId(data.selectedAccount)}
                </span>
              )}
              {accountType && <span className="account-type">{accountType}</span>}
            </div>

            <div className="account-status">
              <span className={`account-status-badge${data.connected && !stale && !syncError ? ' is-connected' : ''}`}>
                {data.connected ? t('ibConnected') : t('ibDisconnected')}
              </span>
              {freshnessLabel && <span className="account-freshness">{freshnessLabel}</span>}
              {data.connected && data.summaryReady === false && (
                <span className="account-freshness">{t('summaryRefreshing')}</span>
              )}
              <span className="account-freshness">{t('notLiveNote')}</span>
            </div>
              </div>

              <div className="account-kpi-strip">
            {kpi.map((item) => {
              const value = item.tag ? metric(item.tag) : item.value;
              return (
                <div key={item.id} className="account-kpi" role="group" aria-label={item.label}>
                  <span className="account-kpi-label">{item.label}</span>
                  <span className={`account-kpi-value${Number.isFinite(value) && value < 0 ? ' is-negative' : ''}`}>
                    {item.id === 'margin' ? (
                      <>
                        <span className="account-kpi-sub">{formatCurrency(metric('MaintMarginReq'), currency)}</span>
                        <span className="account-kpi-note">
                          {`${t('initMargin')} ${formatCurrency(metric('InitMarginReq'), currency)}`}
                        </span>
                      </>
                    ) : (
                      formatCurrency(value, currency)
                    )}
                  </span>
                  <span className="account-kpi-time">{formatClockTime(item.timestamp, language)}</span>
                </div>
              );
            })}
            <div className="account-kpi" role="group" aria-label={t('grossPositionValue')}>
              <span className="account-kpi-label">{t('grossPositionValue')}</span>
              <span className="account-kpi-value">{formatCurrency(metric('GrossPositionValue'), currency)}</span>
              <span className="account-kpi-time">{formatClockTime(data?.summaryUpdatedAt, language)}</span>
            </div>
              </div>

              {nav == null && metric('GrossPositionValue') == null && (
                <div className="account-overview-note">{t('noAccountMetrics')}</div>
              )}

              <section className="account-alerts" aria-label={t('alerts')}>
            <span className="account-section-title">{t('alerts')}</span>
            {alerts.length === 0 ? (
              <span className="account-alerts-empty">{t('noAlerts')}</span>
            ) : (
              <ul className="account-alerts-list" aria-live="polite">
                {alerts.map((alert) => (
                  <li key={alert.id} className={`account-alert account-alert-${alert.tone}`}>
                    <span className="account-alert-label">{alert.label}</span>
                    <span className="account-alert-detail">{alert.detail}</span>
                  </li>
                ))}
              </ul>
            )}
              </section>
            </>
          )}

          {isMaximized && weightedHoldings.length > 0 && (
            <section className="account-allocation" aria-label={t('allocation')}>
              <span className="account-section-title">{t('allocation')}</span>
              <ul className="account-allocation-list">
                {weightedHoldings.map((row) => {
                  const weight = row.weight;
                  const width = maxWeight > 0 ? (Math.abs(weight) / maxWeight) * 100 : 0;
                  const isShort = Number(row.quantity) < 0;
                  return (
                    <li key={`bar-${row.id ?? row.symbol}`}>
                      <button
                        type="button"
                        className={`account-allocation-bar${isShort ? ' is-short' : ''}`}
                        onClick={() => handleSelectSymbol(row)}
                        aria-label={t('allocationBarLabel', {
                          symbol: row.symbol,
                          percent: weight.toFixed(1),
                          value: formatCurrency(row.marketValue, row.currency),
                        })}
                      >
                        <span className="account-allocation-symbol">
                          {row.symbol}
                          {isShort && <span className="account-short-tag">{t('short')}</span>}
                        </span>
                        <span className="account-allocation-track">
                          <span className="account-allocation-fill" style={{ width: `${width}%` }} />
                        </span>
                        <span className="account-allocation-value">
                          {formatCurrency(row.marketValue, row.currency)}
                          <span className="account-allocation-weight">{formatPercent(weight)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {holdings.length > 0 ? (
            <div id="portfolio-table-wrapper">
              <table id="portfolio-table">
                <caption className="account-overview-sr">{t('holdings')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('symbol')}</th>
                    <th scope="col" className="align-right">{t('qty')}</th>
                    <th scope="col" className="align-right">{t('avgCost')}</th>
                    <th scope="col" className="align-right col-extra">{t('marketPrice')}</th>
                    <th scope="col" className="align-right">{t('marketValue')}</th>
                    <th scope="col" className="align-right">{t('unrealizedPnl')}</th>
                    <th scope="col" className="align-right">{t('weight')}</th>
                    <th scope="col" className="col-extra">{t('currency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((row) => {
                    const isShort = Number(row.quantity) < 0;
                    return (
                      <tr
                        key={row.id ?? row.symbol}
                        className="portfolio-clickable-row"
                        onClick={() => handleSelectSymbol(row)}
                        title={t('loadChart', { symbol: row.symbol })}
                      >
                        <td className="portfolio-symbol-cell">
                          <button
                            type="button"
                            className="portfolio-symbol-button"
                            aria-label={t('loadChart', { symbol: row.symbol })}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectSymbol(row);
                            }}
                          >
                            {row.symbol}
                          </button>
                          {isShort && <span className="account-short-tag">{t('short')}</span>}
                        </td>
                        <td className="align-right portfolio-num">{formatQuantity(row.quantity)}</td>
                        <td className="align-right portfolio-num">{formatNumber(row.averageCost)}</td>
                        <td className="align-right portfolio-num col-extra">
                          {formatNumber(row.marketPrice)}
                        </td>
                        <td className="align-right portfolio-num">{formatCurrency(row.marketValue, row.currency)}</td>
                        <td className={`align-right portfolio-num${row.unrealizedPnl < 0 ? ' is-negative' : ''}`}>
                          {formatCurrency(row.unrealizedPnl, row.currency)}
                        </td>
                        <td className="align-right portfolio-num">{formatPercent(row.weight)}</td>
                        <td className="col-extra">{row.currency}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div id="portfolio-empty-state">
              <span className="portfolio-empty-title">{t('noIBPositions')}</span>
              <span className="portfolio-empty-sub">{t('makeSureIB')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AccountOverview;
