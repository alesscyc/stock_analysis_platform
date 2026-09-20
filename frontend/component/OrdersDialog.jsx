import { Fragment, useState, useEffect } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
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

function OrdersDialog({ isOpen, onStockSelect, mode = 'live', paperOrders = [], paperHistory = [], onPaperCancel }) {
  const [orders, setOrders] = useState([]);
  const [paperView, setPaperView] = useState('open');
  const [expandedBracket, setExpandedBracket] = useState(null);
  const [submittedPrices, setSubmittedPrices] = useState(loadSubmittedOrderPrices);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (mode === 'paper') setError(null);
  }, [mode]);

  useEffect(() => {
    if (!isOpen || mode === 'paper') return;

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
          throw new Error(data.error || t('failedLoadPendingOrders'));
        }

        setOrders(Array.isArray(data) ? data : []);
      } catch (fetchError) {
        if (active && fetchError.name !== 'AbortError') {
          setError(fetchError.message || t('failedLoadPendingOrders'));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, mode, t]);

  const paperRows = (() => {
    const all = [...new Map([...paperOrders, ...paperHistory].map((order) => [order.id, order])).values()];
    return all.filter((order) => !order.parentId).flatMap((order) => {
      const children = all.filter((child) => child.parentId === order.id);
      if (!children.length) {
        const belongs = paperView === 'open' ? paperOrders.some((row) => row.id === order.id) : paperHistory.some((row) => row.id === order.id);
        return belongs ? [order] : [];
      }
      const group = [order, ...children];
      const open = group.filter((row) => ['Submitted', 'Inactive'].includes(row.status));
      if ((paperView === 'open') !== (open.length > 0)) return [];
      return [{ ...order, status: open.length ? 'Submitted' : order.status, _children: children, _cancelRef: open[0]?.id }];
    });
  })();
  const displayedOrders = mode === 'paper' ? paperRows : orders;
  const displayLoading = mode === 'live' && loading;
  const displayError = error;

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

  const handleRowKeyDown = (event, row, index) => {
    if (event.target.closest('button')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleRowClick(row);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.min(displayedOrders.length - 1, Math.max(0, index + direction));
    event.currentTarget.parentElement?.children[nextIndex]?.focus();
    handleRowClick(displayedOrders[nextIndex]);
  };

  const getOrderRef = (row) => row._cancelRef ?? row.id ?? row.permId ?? row.orderId;

  const handleCancelOrder = async (row) => {
    const orderRef = getOrderRef(row);
    setCancellingId(orderRef);
    setError(null);
    try {
      if (mode === 'paper') {
        await onPaperCancel(orderRef);
      } else {
        const response = await fetch(`/api/orders/${encodeURIComponent(orderRef)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t('failedCancelOrder'));
        setOrders((prev) => prev.filter((o) => getOrderRef(o) !== orderRef));
      }
    } catch (err) {
      setError(err.message || t('failedCancelOrder'));
    } finally {
      setCancellingId(null);
    }
  };

  const canCancel = (status) => {
    return ['PreSubmitted', 'Submitted'].includes(status);
  };

  return (
    <div
      id="orders-dialog-sidebar"
      role="tabpanel"
      aria-labelledby="orders-tab"
      hidden={!isOpen}
    >
        {mode === 'paper' && (
          <div className="orders-history-tabs" role="tablist" aria-label={t('paperOrders')}>
            <button type="button" role="tab" aria-selected={paperView === 'open'} onClick={() => setPaperView('open')}>{t('openOrders')}</button>
            <button type="button" role="tab" aria-selected={paperView === 'history'} onClick={() => setPaperView('history')}>{t('orderHistory')}</button>
          </div>
        )}

        {/* Loading state */}
        {displayLoading && (
          <div id="orders-loading-state">
            <span className="orders-spinner" />
            <span>{t('loadingPendingOrders')}</span>
          </div>
        )}

        {/* Error state */}
        {displayError && (
          <div id="orders-error-state">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {displayError}
          </div>
        )}

        {/* Empty state */}
        {!displayLoading && !displayError && displayedOrders.length === 0 && (
          <div id="orders-empty-state">
            <div className="orders-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <span className="orders-empty-title">{t('noPendingOrders')}</span>
            <span className="orders-empty-sub">{t('noActiveOrders')}</span>
          </div>
        )}

        {/* Orders table */}
        {!displayLoading && !displayError && displayedOrders.length > 0 && (
          <>
            {/* Summary row */}
            <div id="orders-summary">
              <div className="orders-stat">
                <span className="orders-stat-label">{t('totalOrders')}</span>
                <span className="orders-stat-value">{displayedOrders.length}</span>
              </div>
            </div>

            <div id="orders-table-wrapper">
              <table id="orders-table">
                <thead>
                  <tr>
                    <th className="align-center">{t('symbol')}</th>
                    <th className="align-center">{t('action')}</th>
                    <th className="align-center">{t('qty')}</th>
                    <th className="align-center">{t('typePrice')}</th>
                    <th className="align-center">{t('status')}</th>
                    <th className="align-center"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedOrders.map((row, index) => {
                    const key = row.id ?? row.permId ?? `${row.orderId}-${index}`;
                    const expanded = expandedBracket === key;
                    return <Fragment key={key}>
                      <tr
                        className="orders-clickable-row"
                        onClick={() => handleRowClick(row)}
                        onKeyDown={(event) => handleRowKeyDown(event, row, index)}
                        role="button"
                        tabIndex={0}
                        title={t('loadChart', { symbol: row.symbol })}
                      >
                        <td className="align-center orders-symbol-cell">
                          {row.symbol}
                          {row._children && <button
                            type="button"
                            className="orders-expand-btn"
                            aria-expanded={expanded}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedBracket(expanded ? null : key);
                            }}
                          >{expanded ? '−' : '+'}</button>}
                        </td>
                        <td className="align-center orders-action-cell">
                          <span className={`orders-action-badge ${row.action.toLowerCase()}`}>{row.action}</span>
                        </td>
                        <td className="align-center orders-num">{Number(row.quantity).toLocaleString()}</td>
                        <td className="align-center orders-num">{row.orderType || '—'} / {formatLimitPrice(getOrderPrice(row))}</td>
                        <td className="align-center">
                          <span className={`orders-status-badge ${getStatusBadgeClass(row.status)}`}>{row.status}</span>
                        </td>
                        <td className="align-center">
                          {canCancel(row.status) && (
                            <button
                              className="orders-cancel-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCancelOrder(row);
                              }}
                              disabled={cancellingId === getOrderRef(row)}
                              aria-label={t('cancelOrder')}
                              title={t('cancelOrder')}
                            >
                              {cancellingId === getOrderRef(row) ? <span className="orders-cancel-spinner" /> : '×'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && row._children && (
                        <tr className="orders-bracket-details">
                          <td colSpan="6">
                            {[row, ...row._children].map((leg) => (
                              <span key={leg.id}>{leg.bracketRole || 'parent'}: {leg.orderType} {formatLimitPrice(getOrderPrice(leg))} · {leg.status}</span>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>;
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
  );
}

export default OrdersDialog;
