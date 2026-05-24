import { useState, useEffect } from 'react';
import './OrdersDialog.css';

const SUBMITTED_ORDER_PRICES_KEY = 'stockai-submitted-order-prices';

function loadSubmittedOrderPrices() {
  try {
    const raw = localStorage.getItem(SUBMITTED_ORDER_PRICES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function OrdersDialog({ isOpen, onClose, onStockSelect }) {
  const [orders, setOrders] = useState([]);
  const [submittedPrices, setSubmittedPrices] = useState(loadSubmittedOrderPrices);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);
    setSubmittedPrices(loadSubmittedOrderPrices());

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

  const getOrderPrice = (row) => {
    return row.limitPrice ?? row.price ?? row.lmtPrice ?? row.auxPrice ?? submittedPrices[String(row.orderId)];
  };

  const formatLimitPrice = (price) => {
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0 || Math.abs(value) > 1e10) {
      return '—';
    }
    return `$${value.toFixed(2)}`;
  };

  const handleRowClick = (row) => {
    if (!row.symbol || !onStockSelect) return;
    onStockSelect({ symbol: row.symbol });
  };

  const handleRowKeyDown = (event, row) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleRowClick(row);
  };

  const handleCancelOrder = async (orderId) => {
    setCancellingId(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel order');
      }
      setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
    } catch (err) {
      setError(err.message || 'Failed to cancel order');
    } finally {
      setCancellingId(null);
    }
  };

  const canCancel = (status) => {
    return ['PreSubmitted', 'Submitted'].includes(status);
  };

  return (
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
                    <th className="align-center">Symbol</th>
                    <th className="align-center">Action</th>
                    <th className="align-center">Qty</th>
                    <th className="align-center">Type / Price</th>
                    <th className="align-center">Status</th>
                    <th className="align-center"></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((row) => (
                    <tr
                      key={row.orderId}
                      className="orders-clickable-row"
                      onClick={() => handleRowClick(row)}
                      onKeyDown={(event) => handleRowKeyDown(event, row)}
                      role="button"
                      tabIndex={0}
                      title={`Load ${row.symbol} chart`}
                    >
                      <td className="align-center orders-symbol-cell">{row.symbol}</td>
                      <td className="align-center orders-action-cell">
                        <span className={`orders-action-badge ${row.action.toLowerCase()}`}>
                          {row.action}
                        </span>
                      </td>
                      <td className="align-center orders-num">{Number(row.quantity).toLocaleString()}</td>
                      <td className="align-center orders-num">
                        {row.orderType || '—'} / {formatLimitPrice(getOrderPrice(row))}
                      </td>
                      <td className="align-center">
                        <span className={`orders-status-badge ${getStatusBadgeClass(row.status)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="align-center">
                        {canCancel(row.status) && (
                          <button
                            className="orders-cancel-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelOrder(row.orderId);
                            }}
                            disabled={cancellingId === row.orderId}
                            aria-label={`Cancel order ${row.orderId}`}
                            title="Cancel order"
                          >
                            {cancellingId === row.orderId ? (
                              <span className="orders-cancel-spinner" />
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            )}
                          </button>
                        )}
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

export default OrdersDialog;
