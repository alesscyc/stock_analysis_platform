import { useState } from 'react';
import './TradeDialog.css';

function TradeDialog({ isOpen, onClose, stockSymbol }) {
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);


  if (!isOpen) return null;

  const handleBuy = async () => {
    if (!amount || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    if (!price || price <= 0) {
      alert('Please enter a valid price');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: stockSymbol,
          price: parseFloat(price),
          amount: parseInt(amount),
        }),
      });

      const data = await response.json();
      if (data.success) {
        alert(`Order submitted successfully at price $${data.price}`);
        onClose();
      } else {
        alert('Failed to submit order: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error submitting order:', error);
      alert('Network error while submitting order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop/Mask */}
      <div
        id="trade-dialog-backdrop"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div id="trade-dialog-sidebar">
        <h2 id="trade-dialog-title">Trade {stockSymbol}</h2>
        
        <div className="trade-field-group">
          <label htmlFor="trade-price-input">Price</label>
          <input
            id="trade-price-input"
            type="number"
            placeholder="Price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>

        <div className="trade-field-group">
          <label htmlFor="trade-amount-input">Amount</label>
          <input
            id="trade-amount-input"
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <button
          id="trade-buy-btn"
          onClick={handleBuy}
          disabled={loading}
        >
          {loading ? 'PROCESSING...' : 'BUY'}
        </button>
      </div>
    </>
  );
}

export default TradeDialog;
