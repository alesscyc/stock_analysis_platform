import { useState, useEffect } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
import './PortfolioDialog.css';

function PortfolioDialog({ isOpen, onClose, onStockSelect }) {
  const { t } = useTranslation();
  const [portfolio, setPortfolio] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch('/api/portfolio', {
          signal: controller.signal,
        });
        const data = await response.json();

        if (!active) return;

        if (!response.ok) {
          throw new Error(data.error || t('failedLoadPortfolio'));
        }

        setPortfolio(Array.isArray(data) ? data : []);
      } catch (fetchError) {
        if (active && fetchError.name !== 'AbortError') {
          setError(fetchError.message || t('failedLoadPortfolio'));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, t]);

  if (!isOpen) return null;

  const totalValue = portfolio.reduce((sum, row) => {
    const avgCost = Number(row.avgCost ?? row.average_price ?? row.averagePrice ?? 0);
    const quantity = Number(row.quantity ?? 0);
    const costBasis = Number(row.costBasis ?? row.cost_basis ?? Math.abs(quantity) * avgCost);
    return sum + costBasis;
  }, 0);

  const handleSymbolClick = (row) => {
    if (!row.symbol || !onStockSelect) return;
    onStockSelect({ symbol: row.symbol });
  };

  const handleRowKeyDown = (event, row, index) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSymbolClick(row);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.min(portfolio.length - 1, Math.max(0, index + direction));
    event.currentTarget.parentElement?.children[nextIndex]?.focus();
    handleSymbolClick(portfolio[nextIndex]);
  };

  return (
    <div id="portfolio-dialog-sidebar" role="dialog" aria-modal="true" aria-label={t('portfolio')}>

        {/* Header */}
        <div id="portfolio-dialog-header">
          <div id="portfolio-header-left">
            <div id="portfolio-type-badge">{t('holdings')}</div>
            <h2 id="portfolio-dialog-title">{t('portfolio')}</h2>
          </div>
          <button id="portfolio-dialog-close-btn" onClick={onClose} aria-label={t('closePortfolio')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div id="portfolio-loading-state">
            <span className="portfolio-spinner" />
            <span>{t('loadingIBPositions')}</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div id="portfolio-error-state">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && portfolio.length === 0 && (
          <div id="portfolio-empty-state">
            <div className="portfolio-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2"/>
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              </svg>
            </div>
            <span className="portfolio-empty-title">{t('noIBPositions')}</span>
            <span className="portfolio-empty-sub">{t('makeSureIB')}</span>
          </div>
        )}

        {/* Holdings table */}
        {!loading && !error && portfolio.length > 0 && (
          <>
            {/* Summary row */}
            <div id="portfolio-summary">
              <div className="portfolio-stat">
                <span className="portfolio-stat-label">{t('positions')}</span>
                <span className="portfolio-stat-value">{portfolio.length}</span>
              </div>
              <div className="portfolio-stat">
                <span className="portfolio-stat-label">{t('totalCostBasis')}</span>
                <span className="portfolio-stat-value">
                  ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div id="portfolio-table-wrapper">
              <table id="portfolio-table">
                <thead>
                  <tr>
                    <th>{t('type')}</th>
                    <th>{t('symbol')}</th>
                    <th className="align-right">{t('qty')}</th>
                    <th className="align-right">{t('avgCost')}</th>
                    <th className="align-right">{t('costBasis')}</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.map((row, index) => (
                    <tr
                      key={row.id ?? row.symbol}
                      className="portfolio-clickable-row"
                      onClick={() => handleSymbolClick(row)}
                      onKeyDown={(event) => handleRowKeyDown(event, row, index)}
                      role="button"
                      tabIndex={0}
                      title={t('loadChart', { symbol: row.symbol })}
                    >
                      <td>{row.type}</td>
                      <td className="portfolio-symbol-cell">{row.symbol}</td>
                      <td className="align-right portfolio-num">{Math.abs(Number(row.quantity ?? 0)).toLocaleString()}</td>
                      <td className="align-right portfolio-num">
                        ${Number(row.avgCost ?? row.average_price ?? 0).toFixed(2)}
                      </td>
                      <td className="align-right portfolio-num">
                        ${Number(row.costBasis ?? row.cost_basis ?? (Math.abs(Number(row.quantity ?? 0)) * Number(row.avgCost ?? row.average_price ?? 0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
  );
}

export default PortfolioDialog;
