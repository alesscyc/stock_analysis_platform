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
        if (data.error) {
          setError(data.error);
        } else {
          setPortfolio(data);
        }
      })
      .catch(() => setError('Failed to load portfolio'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        id="portfolio-dialog-backdrop"
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <div id="portfolio-dialog-sidebar">
        {/* Header */}
        <div id="portfolio-dialog-header">
          <h2 id="portfolio-dialog-title">Portfolio</h2>
        </div>

        {/* Content */}
        {loading && (
          <p id="portfolio-loading-msg">Loading...</p>
        )}

        {error && (
          <p id="portfolio-error-msg">{error}</p>
        )}

        {!loading && !error && portfolio.length === 0 && (
          <p id="portfolio-empty-msg">No holdings yet.</p>
        )}

        {!loading && !error && portfolio.length > 0 && (
          <table id="portfolio-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type</th>
                <th className="align-right">Quantity</th>
                <th className="align-right">Avg Price</th>
                <th className="align-right">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.map((row, i) => (
                <tr
                  key={row.id}
                  className={i % 2 === 0 ? 'portfolio-row-even' : 'portfolio-row-odd'}
                >
                  <td className="portfolio-symbol-cell">{row.symbol}</td>
                  <td className="portfolio-type-cell">{row.type}</td>
                  <td className="align-right">{row.quantity.toLocaleString()}</td>
                  <td className="align-right">${Number(row.average_price).toFixed(2)}</td>
                  <td className="align-right">${(row.quantity * row.average_price).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default PortfolioDialog;
