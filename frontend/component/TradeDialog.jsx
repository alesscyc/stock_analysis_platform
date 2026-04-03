import { useState } from 'react';


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
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          zIndex: 999,
          cursor: 'default'
        }}
      />

      {/* Sidebar */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '30%',
        height: '100%',
        backgroundColor: 'white',
        boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
        zIndex: 1000,
        boxSizing: 'border-box',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <h2 style={{ margin: 0 }}>Trade {stockSymbol}</h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ fontWeight: 'bold' }}>Price</label>
          <input 
            type="number" 
            placeholder="Price" 
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ fontWeight: 'bold' }}>Amount</label>
          <input 
            type="number" 
            placeholder="Amount" 
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
        </div>

        <button 
          onClick={handleBuy}
          disabled={loading}
          style={{
            padding: '12px',
            backgroundColor: loading ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontWeight: 'bold',
            cursor: loading ? 'not-allowed' : 'pointer',
            marginTop: 'auto'
          }}
        >
          {loading ? 'PROCESSING...' : 'BUY'}
        </button>
      </div>
    </>
  );
}

export default TradeDialog;
