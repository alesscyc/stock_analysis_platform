import { useState, useEffect } from 'react';
import './PortfolioDialog.css';

function PortfolioDialog({ isOpen, onClose }) {
  const [portfolio, setPortfolio] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    fetch('http://localhost:3001/api/portfolio')
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setPortfolio(data);
      })
      .catch(() => setError('Failed to load portfolio'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const totalValue = portfolio.reduce((sum, row) => sum + row.quantity * row.average_price, 0);

  return (
    <>
      <div id="portfolio-dialog-backdrop" onClick={onClose} />

      <div id="portfolio-dialog-sidebar" role="dialog" aria-modal="true" aria-label="Portfolio">

        {/* Header */}
        <div id="portfolio-dialog-header">
          <div id="portfolio-header-left">
            <div id="portfolio-type-badge">HOLDINGS</div>
            <h2 id="portfolio-dialog-title">Portfolio</h2>
          </div>
          <button id="portfolio-dialog-close-btn" onClick={onClose} aria-label="Close portfolio">
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
            <span>Loading holdings…</span>
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
            <span className="portfolio-empty-title">No holdings yet</span>
            <span className="portfolio-empty-sub">Place a buy order to start building your portfolio.</span>
          </div>
        )}

        {/* Holdings table */}
        {!loading && !error && portfolio.length > 0 && (
          <>
            {/* Summary row */}
            <div id="portfolio-summary">
              <div className="portfolio-stat">
                <span className="portfolio-stat-label">Positions</span>
                <span className="portfolio-stat-value">{portfolio.length}</span>
              </div>
              <div className="portfolio-stat">
                <span className="portfolio-stat-label">Total Cost</span>
                <span className="portfolio-stat-value">
                  ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div id="portfolio-table-wrapper">
              <table id="portfolio-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Type</th>
                    <th className="align-right">Qty</th>
                    <th className="align-right">Avg Price</th>
                    <th className="align-right">Cost Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.map((row) => (
                    <tr key={row.id}>
                      <td className="portfolio-symbol-cell">{row.symbol}</td>
                      <td>
                        <span className={`portfolio-type-badge ${row.type === 'buy' ? 'type-buy' : 'type-sell'}`}>
                          {row.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="align-right portfolio-num">{row.quantity.toLocaleString()}</td>
                      <td className="align-right portfolio-num">${Number(row.average_price).toFixed(2)}</td>
                      <td className="align-right portfolio-num">
                        ${(row.quantity * row.average_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default PortfolioDialog;
