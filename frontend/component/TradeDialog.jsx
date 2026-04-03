import React from 'react';

function TradeDialog({ isOpen, onClose, stockSymbol }) {
  if (!isOpen) return null;

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
            style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ fontWeight: 'bold' }}>Amount</label>
          <input 
            type="number" 
            placeholder="Amount" 
            style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
        </div>

        <button style={{
          padding: '12px',
          backgroundColor: '#28a745',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontWeight: 'bold',
          cursor: 'pointer',
          marginTop: 'auto'
        }}>
          BUY
        </button>
      </div>
    </>
  );
}

export default TradeDialog;
