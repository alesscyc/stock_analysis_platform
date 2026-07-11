import { useEffect, useState } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
import './TradeDialog.css';

const SUBMITTED_ORDER_PRICES_KEY = 'stockai-submitted-order-prices';

function rememberSubmittedOrderPrice(orderId, orderPrice) {
  if (orderId == null) return;

  try {
    const raw = localStorage.getItem(SUBMITTED_ORDER_PRICES_KEY);
    const prices = raw ? JSON.parse(raw) : {};
    prices[String(orderId)] = Number(orderPrice);
    localStorage.setItem(SUBMITTED_ORDER_PRICES_KEY, JSON.stringify(prices));
  } catch {
    // Ignore localStorage failures; backend still receives the order.
  }
}

function TradeDialog({ isOpen, onClose, stockSymbol, ibConnected, modification, onModificationPriceChange, onModified }) {
  const { t } = useTranslation();
  const [action, setAction] = useState('BUY');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [tif, setTif] = useState('DAY');
  const [isBracketOrder, setIsBracketOrder] = useState(false);
  const [takeProfitPrice, setTakeProfitPrice] = useState('');
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [takeProfitError, setTakeProfitError] = useState('');
  const [stopLossError, setStopLossError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const isModifyMode = Boolean(modification?.order);

  const handlePriceChange = (nextPrice) => {
    setPrice(nextPrice);
    setPriceError('');

    if (!isModifyMode) return;
    const numericPrice = Number(nextPrice);
    if (Number.isFinite(numericPrice) && numericPrice > 0) {
      onModificationPriceChange?.(numericPrice);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    if (!modification?.order) {
      setAction('BUY');
      setPrice('');
      setAmount('');
      setTif('DAY');
      setIsBracketOrder(false);
      setTakeProfitPrice('');
      setStopLossPrice('');
      setPriceError('');
      setAmountError('');
      setTakeProfitError('');
      setStopLossError('');
      setSuccessMsg('');
      setErrorMsg('');
      return;
    }

    const order = modification.order;
    const nextPrice = Number(modification.price ?? order.limitPrice);
    setAction(order.action === 'SELL' ? 'SELL' : 'BUY');
    setPrice(Number.isFinite(nextPrice) ? nextPrice.toFixed(2) : '');
    setAmount(String(Number(order.remaining || order.quantity || 0) || ''));
    setTif(order.tif || 'DAY');
    setIsBracketOrder(false);
    setTakeProfitPrice('');
    setStopLossPrice('');
    setPriceError('');
    setAmountError('');
    setTakeProfitError('');
    setStopLossError('');
    setSuccessMsg('');
    setErrorMsg('');
  }, [isOpen, modification]);

  if (!isOpen) return null;

  const validate = () => {
    let valid = true;
    setPriceError('');
    setAmountError('');
    setTakeProfitError('');
    setStopLossError('');
    setSuccessMsg('');
    setErrorMsg('');

    const entryPrice = parseFloat(price);
    const profitPrice = parseFloat(takeProfitPrice);
    const lossPrice = parseFloat(stopLossPrice);

    if (!price || isNaN(price) || entryPrice <= 0) {
      setPriceError(t('enterValidPrice'));
      valid = false;
    }
    if (!amount || isNaN(amount) || parseInt(amount) <= 0) {
      setAmountError(t('enterValidShares'));
      valid = false;
    }

    if (isBracketOrder) {
      if (!takeProfitPrice || isNaN(takeProfitPrice) || profitPrice <= 0) {
        setTakeProfitError(t('enterValidTakeProfit'));
        valid = false;
      } else if (Number.isFinite(entryPrice) && (action === 'BUY' ? profitPrice <= entryPrice : profitPrice >= entryPrice)) {
        setTakeProfitError(action === 'BUY' ? t('takeProfitAboveEntry') : t('takeProfitBelowEntry'));
        valid = false;
      }

      if (!stopLossPrice || isNaN(stopLossPrice) || lossPrice <= 0) {
        setStopLossError(t('enterValidStopLoss'));
        valid = false;
      } else if (Number.isFinite(entryPrice) && (action === 'BUY' ? lossPrice >= entryPrice : lossPrice <= entryPrice)) {
        setStopLossError(action === 'BUY' ? t('stopLossBelowEntry') : t('stopLossAboveEntry'));
        valid = false;
      }
    }

    return valid;
  };

  const handleSubmitOrder = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      if (isModifyMode) {
        const orderRef = modification.order.id ?? modification.order.permId ?? modification.order.orderId;
        const response = await fetch(`/api/orders/${encodeURIComponent(orderRef)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: parseFloat(price) }),
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || t('unknownError'));
        }

        setSuccessMsg(t('orderModified', {
          action: action === 'BUY' ? t('buyAction') : t('sellAction'),
          amount,
          symbol: stockSymbol,
          price: data.price ?? price
        }));
        onModified?.();
        return;
      }

      const orderPayload = {
        symbol: stockSymbol,
        price: parseFloat(price),
        quantity: parseInt(amount),
        action,
        tif,
      };

      if (isBracketOrder) {
        orderPayload.bracket = {
          takeProfitPrice: parseFloat(takeProfitPrice),
          stopLossPrice: parseFloat(stopLossPrice),
        };
      }

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      });

      const data = await response.json();
      if (data.success) {
        rememberSubmittedOrderPrice(data.orderId, data.price ?? price);
        setSuccessMsg(t('orderSubmitted', {
          type: data.orderType === 'BRACKET' ? t('bracketOrder') : t('order'),
          action: action === 'BUY' ? t('buyAction') : t('sellAction'),
          amount,
          symbol: stockSymbol,
          price: data.price ?? price
        }));
        setPrice('');
        setAmount('');
        setTif('DAY');
        setIsBracketOrder(false);
        setTakeProfitPrice('');
        setStopLossPrice('');
      } else {
        setErrorMsg(t('failedSubmitOrder', { error: data.error || t('unknownError') }));
      }
    } catch (error) {
      if (isModifyMode && error.message) {
        setErrorMsg(t('failedModifyOrder', { error: error.message }));
      } else {
        setErrorMsg(t('networkError'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAction('BUY');
    setPriceError('');
    setAmountError('');
    setTakeProfitError('');
    setStopLossError('');
    setSuccessMsg('');
    setErrorMsg('');
    setPrice('');
    setAmount('');
    setTif('DAY');
    setIsBracketOrder(false);
    setTakeProfitPrice('');
    setStopLossPrice('');
    onClose();
  };

  const totalValue = price && amount && !isNaN(price) && !isNaN(amount)
    ? (parseFloat(price) * parseInt(amount)).toFixed(2)
    : null;

  return (
    <div id="trade-dialog-sidebar" role="dialog" aria-modal="true" aria-label={t('tradeSymbol', { symbol: stockSymbol })}>

        {/* Header */}
        <div id="trade-dialog-header">
          <div id="trade-dialog-header-left">
            <div id="trade-dialog-type-badge">{isModifyMode ? t('modifyOrder') : t('orderTicket')}</div>
            <h2 id="trade-dialog-title">
              <span id="trade-dialog-symbol">{stockSymbol}</span>
            </h2>
          </div>
          <button id="trade-dialog-close-btn" onClick={handleClose} aria-label={t('close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Order direction selector */}
        <div id="trade-order-type">
          <button
            className={`order-type-btn ${action === 'BUY' ? 'active buy' : ''}`}
            onClick={() => setAction('BUY')}
            disabled={isModifyMode}
            type="button"
          >
            {t('buy')}
          </button>
          <button
            className={`order-type-btn ${action === 'SELL' ? 'active sell' : ''}`}
            onClick={() => setAction('SELL')}
            disabled={isModifyMode}
            type="button"
          >
            {t('sell')}
          </button>
        </div>

        <div id="trade-fields">
          {/* Price */}
          <div className="trade-field-group">
            <label htmlFor="trade-price-input" className="trade-label">
              {t('priceUSD')}
            </label>
            <div className={`trade-input-wrapper${priceError ? ' has-error' : ''}`}>
              <span className="trade-input-prefix">$</span>
              <input
                id="trade-price-input"
                type="number"
                placeholder="0.00"
                value={price}
                onChange={(e) => handlePriceChange(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>
            {priceError && <span className="trade-field-error">{priceError}</span>}
          </div>

          {/* Amount */}
          <div className="trade-field-group">
            <label htmlFor="trade-amount-input" className="trade-label">
              {t('shares')}
            </label>
            <div className={`trade-input-wrapper${amountError ? ' has-error' : ''}`}>
              <span className="trade-input-prefix">#</span>
              <input
                id="trade-amount-input"
                type="number"
                placeholder="0"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountError(''); }}
                disabled={isModifyMode}
                min="1"
                step="1"
              />
            </div>
            {amountError && <span className="trade-field-error">{amountError}</span>}
          </div>

          <div className="trade-field-group">
            <label htmlFor="trade-tif-select" className="trade-label">
              {t('timeInForce')}
            </label>
            <div className="trade-select-wrapper">
              <select
                id="trade-tif-select"
                value={tif}
                onChange={(e) => setTif(e.target.value)}
                disabled={isModifyMode}
              >
                <option value="DAY">{t('day')}</option>
                <option value="GTC">{t('goodTillCancelled')}</option>
                <option value="IOC">{t('immediateOrCancel')}</option>
                <option value="FOK">{t('fillOrKill')}</option>
              </select>
            </div>
          </div>

          {!isModifyMode && <div className="trade-bracket-toggle">
            <div>
              <span className="trade-bracket-title">{t('bracketExits')}</span>
              <span className="trade-bracket-copy">{t('bracketExitsDesc')}</span>
            </div>
            <label className="trade-switch" htmlFor="trade-bracket-toggle-input">
              <input
                id="trade-bracket-toggle-input"
                type="checkbox"
                checked={isBracketOrder}
                onChange={(e) => {
                  setIsBracketOrder(e.target.checked);
                  setTakeProfitError('');
                  setStopLossError('');
                }}
              />
              <span className="trade-switch-slider" />
            </label>
          </div>}

          {!isModifyMode && isBracketOrder && (
            <div className="trade-bracket-fields">
              <div className="trade-field-group">
                <label htmlFor="trade-take-profit-input" className="trade-label">
                  {t('takeProfitUSD')}
                </label>
                <div className={`trade-input-wrapper${takeProfitError ? ' has-error' : ''}`}>
                  <span className="trade-input-prefix">$</span>
                  <input
                    id="trade-take-profit-input"
                    type="number"
                    placeholder={action === 'BUY' ? t('aboveEntry') : t('belowEntry')}
                    value={takeProfitPrice}
                    onChange={(e) => { setTakeProfitPrice(e.target.value); setTakeProfitError(''); }}
                    min="0"
                    step="0.01"
                  />
                </div>
                {takeProfitError && <span className="trade-field-error">{takeProfitError}</span>}
              </div>

              <div className="trade-field-group">
                <label htmlFor="trade-stop-loss-input" className="trade-label">
                  {t('stopLossUSD')}
                </label>
                <div className={`trade-input-wrapper${stopLossError ? ' has-error' : ''}`}>
                  <span className="trade-input-prefix">$</span>
                  <input
                    id="trade-stop-loss-input"
                    type="number"
                    placeholder={action === 'BUY' ? t('belowEntry') : t('aboveEntry')}
                    value={stopLossPrice}
                    onChange={(e) => { setStopLossPrice(e.target.value); setStopLossError(''); }}
                    min="0"
                    step="0.01"
                  />
                </div>
                {stopLossError && <span className="trade-field-error">{stopLossError}</span>}
              </div>
            </div>
          )}
        </div>

        {/* Order summary */}
        {totalValue && (
          <div id="trade-order-summary">
            <span className="summary-label">{t('estimatedTotal')}</span>
            <span className="summary-value">${parseFloat(totalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        )}

        {/* Inline feedback */}
        {successMsg && <div className="trade-feedback trade-feedback-success">{successMsg}</div>}
        {errorMsg && <div className="trade-feedback trade-feedback-error">{errorMsg}</div>}
        {!ibConnected && (
          <div className="trade-feedback trade-feedback-error">{t('ibNotConnected')}</div>
        )}

        {/* Submit order CTA */}
        <button
          id="trade-buy-btn"
          onClick={handleSubmitOrder}
          disabled={loading || !ibConnected}
        >
          {loading ? (
            <span className="btn-spinner" />
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                <polyline points="17 6 23 6 23 12"/>
              </svg>
              {isModifyMode ? t('confirmChange') : t('placeOrder', { type: isBracketOrder ? t('bracket') : '' })}
            </>
          )}
        </button>

        <p id="trade-disclaimer">
          {isModifyMode ? t('modifyOrderDisclaimer') : t('orderDisclaimer', { bracket: isBracketOrder ? t('withBracket') : '' })}
        </p>
      </div>
  );
}

export default TradeDialog;
