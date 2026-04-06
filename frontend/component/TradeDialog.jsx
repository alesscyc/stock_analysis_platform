import { useState } from 'react';
import './TradeDialog.css';

function TradeDialog({ isOpen, onClose, stockSymbol }) {
  const [action, setAction] = useState('BUY');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [tif, setTif] = useState('DAY');
  const [loading, setLoading] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const validate = () => {
    let valid = true;
    setPriceError('');
    setAmountError('');
    setSuccessMsg('');
    setErrorMsg('');

    if (!price || isNaN(price) || parseFloat(price) <= 0) {
      setPriceError('Enter a valid price greater than 0');
      valid = false;
    }
    if (!amount || isNaN(amount) || parseInt(amount) <= 0) {
      setAmountError('Enter a valid number of shares');
      valid = false;
    }
    return valid;
  };

  const handleSubmitOrder = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: stockSymbol,
          price: parseFloat(price),
          quantity: parseInt(amount),
          action,
          tif,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setSuccessMsg(`Order submitted: ${action} ${amount} ${stockSymbol} @ $${data.price ?? price}`);
        setPrice('');
        setAmount('');
        setTif('DAY');
      } else {
        setErrorMsg('Failed to submit order: ' + (data.error || 'Unknown error'));
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAction('BUY');
    setPriceError('');
    setAmountError('');
    setSuccessMsg('');
    setErrorMsg('');
    setPrice('');
    setAmount('');
    setTif('DAY');
    onClose();
  };

  const totalValue = price && amount && !isNaN(price) && !isNaN(amount)
    ? (parseFloat(price) * parseInt(amount)).toFixed(2)
    : null;

  return (
    <>
      <div id="trade-dialog-backdrop" onClick={handleClose} />

      <div id="trade-dialog-sidebar" role="dialog" aria-modal="true" aria-label={`Trade ${stockSymbol}`}>

        {/* Header */}
        <div id="trade-dialog-header">
          <div id="trade-dialog-header-left">
            <div id="trade-dialog-type-badge">ORDER TICKET</div>
            <h2 id="trade-dialog-title">
              <span id="trade-dialog-symbol">{stockSymbol}</span>
            </h2>
          </div>
          <button id="trade-dialog-close-btn" onClick={handleClose} aria-label="Close">
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
            type="button"
          >
            BUY
          </button>
          <button
            className={`order-type-btn ${action === 'SELL' ? 'active sell' : ''}`}
            onClick={() => setAction('SELL')}
            type="button"
          >
            SELL
          </button>
        </div>

        <div id="trade-fields">
          {/* Price */}
          <div className="trade-field-group">
            <label htmlFor="trade-price-input" className="trade-label">
              Price (USD)
            </label>
            <div className={`trade-input-wrapper${priceError ? ' has-error' : ''}`}>
              <span className="trade-input-prefix">$</span>
              <input
                id="trade-price-input"
                type="number"
                placeholder="0.00"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setPriceError(''); }}
                min="0"
                step="0.01"
              />
            </div>
            {priceError && <span className="trade-field-error">{priceError}</span>}
          </div>

          {/* Amount */}
          <div className="trade-field-group">
            <label htmlFor="trade-amount-input" className="trade-label">
              Shares
            </label>
            <div className={`trade-input-wrapper${amountError ? ' has-error' : ''}`}>
              <span className="trade-input-prefix">#</span>
              <input
                id="trade-amount-input"
                type="number"
                placeholder="0"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountError(''); }}
                min="1"
                step="1"
              />
            </div>
            {amountError && <span className="trade-field-error">{amountError}</span>}
          </div>

          <div className="trade-field-group">
            <label htmlFor="trade-tif-select" className="trade-label">
              Time in Force
            </label>
            <div className="trade-select-wrapper">
              <select
                id="trade-tif-select"
                value={tif}
                onChange={(e) => setTif(e.target.value)}
              >
                <option value="DAY">Day</option>
                <option value="GTC">Good Till Cancelled</option>
                <option value="IOC">Immediate or Cancel</option>
                <option value="FOK">Fill or Kill</option>
              </select>
            </div>
          </div>
        </div>

        {/* Order summary */}
        {totalValue && (
          <div id="trade-order-summary">
            <span className="summary-label">Estimated Total</span>
            <span className="summary-value">${parseFloat(totalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        )}

        {/* Inline feedback */}
        {successMsg && <div className="trade-feedback trade-feedback-success">{successMsg}</div>}
        {errorMsg && <div className="trade-feedback trade-feedback-error">{errorMsg}</div>}

        {/* Submit order CTA */}
        <button
          id="trade-buy-btn"
          onClick={handleSubmitOrder}
          disabled={loading}
        >
          {loading ? (
            <span className="btn-spinner" />
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                <polyline points="17 6 23 6 23 12"/>
              </svg>
              {`Place ${action === 'SELL' ? 'Sell' : 'Buy'} Order`}
            </>
          )}
        </button>

        <p id="trade-disclaimer">
          Orders are routed through your connected IB Gateway using the entered limit price.
        </p>
      </div>
    </>
  );
}

export default TradeDialog;
