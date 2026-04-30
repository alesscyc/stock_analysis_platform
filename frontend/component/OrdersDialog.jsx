import { useState, useEffect } from 'react';
import './OrdersDialog.css';

function OrdersDialog({ isOpen, onClose }) {
  const [orders, setOrders] = useState([]);
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
        const response = await fetch('/api/orders/pending', {
          signal: controller.signal,
        });
        const data = await response.json();

        if (!active) return;

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load pending orders');
        }

        setOrders(Array.isArray(data) ? data : []);
      } catch (fetchError) {
        if (active && fetchError.name !== 'AbortError') {
          setError(fetchError.message || 'Failed to load pending orders');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const getStatusBadgeClass = (status) => {
    const statusMap = {
      'PreSubmitted': 'status-pending',
      'Submitted': 'status-pending',
      'Filled': 'status-filled',
      'Cancelled': 'status-cancelled',
      'ApiCancelled': 'status-cancelled',
      'Rejected': 'status-rejected',
    };
    return statusMap[status] || 'status-unknown';
  };

  return (
    <>
      <div id="orders-dialog-backdrop" onClick={onClose} />

      <div id="orders-dialog-sidebar" role="dialog" aria-modal="true" aria-label="Pending Orders">

        {/* Header */}
        <div id="orders-dialog-header">
          <div id="orders-header-left">
            <div id="orders-type-badge">ORDERS</div>
            <h2 id="orders-dialog-title">Pending Orders</h2>
          </div>
          <button id="orders-dialog-close-btn" onClick={onClose} aria-label="Close orders">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div id="orders-loading-state">
            <span className="orders-spinner" />
            <span>Loading pending orders…</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div id="orders-error-state">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && orders.length === 0 && (
          <div id="orders-empty-state">
            <div className="orders-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <span className="orders-empty-title">No pending orders</span>
            <span className="orders-empty-sub">You have no active orders at the moment.</span>
          </div>
        )}

        {/* Orders table */}
        {!loading && !error && orders.length > 0 && (
          <>
            {/* Summary row */}
            <div id="orders-summary">
              <div className="orders-stat">
                <span className="orders-stat-label">Total Orders</span>
                <span className="orders-stat-value">{orders.length}</span>
              </div>
            </div>

            <div id="orders-table-wrapper">
              <table id="orders-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Action</th>
                    <th className="align-right">Qty</th>
                    <th className="align-right">Price</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((row) => (
                    <tr key={row.orderId}>
                      <td className="orders-symbol-cell">{row.symbol}</td>
                      <td className="orders-action-cell">
                        <span className={`orders-action-badge ${row.action.toLowerCase()}`}>
                          {row.action}
                        </span>
                      </td>
                      <td className="align-right orders-num">{Number(row.quantity).toLocaleString()}</td>
                      <td className="align-right orders-num">${Number(row.limitPrice).toFixed(2)}</td>
                      <td>
                        <span className={`orders-status-badge ${getStatusBadgeClass(row.status)}`}>
                          {row.status}
                        </span>
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

export default OrdersDialog;
