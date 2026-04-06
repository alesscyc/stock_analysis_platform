import './App.css'
import { useState, useMemo } from 'react';
import SearchBar from '../component/SearchBar'
import StockChart from '../component/StockChart';
import PortfolioDialog from '../component/PortfolioDialog';
import OrdersDialog from '../component/OrdersDialog';

function App() {
  const [selectedStock, setSelectedStock] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [currentInterval, setCurrentInterval] = useState('1d');
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiPrediction, setAiPrediction] = useState(null);

  const fetchStockData = async (stock, interval = '1d', autoPredictEnabled = true) => {
    setLoading(true);
    try {
      const autoPredictParam = autoPredictEnabled ? 'true' : 'false';
      const response = await fetch(
        `http://localhost:3001/api/stock/${stock.symbol}?date_range=max&interval=${interval}&auto_predict=${autoPredictParam}`
      );
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        setStockData(data);
        setCurrentInterval(interval);
        // Only update the prediction when the API actually returned one.
        // This keeps the last known prediction visible during interval changes.
        const prediction = data.find(item => item.prediction)?.prediction;
        if (prediction) setAiPrediction(prediction);
      }
    } catch (error) {
      console.error('Error fetching stock data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStockSelect = async (stock) => {
    setSelectedStock(stock);
    setAiPrediction(null);
    await fetchStockData(stock, currentInterval);
  };

  const handleIntervalChange = async (interval) => {
    if (selectedStock) {
      await fetchStockData(selectedStock, interval, false);
    }
  };

  // Derive latest close from stockData for the instrument header
  const latestClose = useMemo(() => {
    if (!stockData || stockData.length === 0) return null;
    const item = [...stockData].reverse().find(d => d.Close != null);
    return item ? (Math.round(parseFloat(item.Close) * 100) / 100) : null;
  }, [stockData]);

  return (
    <div id="root">
      {/* ── Top nav bar ── */}
      <header className="app-topbar">
        <div className="app-brand">
           <div className="app-brand-icon">S</div>
           <span className="app-brand-name">StockAI</span>
         </div>

        <div className="topbar-divider" />

        <div className="topbar-search">
          <SearchBar onStockSelect={handleStockSelect} loading={loading} />
        </div>

        <div className="topbar-actions">
          <button
            className="btn-portfolio"
            onClick={() => setIsPortfolioOpen(true)}
            aria-label="Open portfolio"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
            </svg>
            Portfolio
          </button>
          <button
            className="btn-orders"
            onClick={() => setIsOrdersOpen(true)}
            aria-label="Open pending orders"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            Orders
          </button>
        </div>
      </header>

      {/* ── Instrument header (shows once symbol is loaded) ── */}
      {selectedStock && (
        <div className="instrument-header">
          <span className="instrument-symbol">{selectedStock.symbol}</span>

          {latestClose != null && (
            <span className="instrument-price">
              ${latestClose.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}

          <div className="instrument-stat">
            <span className="instrument-label">Interval</span>
            <span className="instrument-value">
              {currentInterval === '1d' ? 'Daily' : currentInterval === '1wk' ? 'Weekly' : 'Monthly'}
            </span>
          </div>

          {aiPrediction && aiPrediction.status === 'success' && (
            <div className="instrument-stat">
              <span className="instrument-label">AI Signal</span>
              <span
                className="instrument-value"
                style={{ color: aiPrediction.recommendation === 'BUY' ? 'var(--green-bright)' : 'var(--red-bright)' }}
              >
                {aiPrediction.recommendation} · {aiPrediction.confidence}%
              </span>
            </div>
          )}

          {stockData.length > 0 && (
            <div className="instrument-stat">
              <span className="instrument-label">Data Points</span>
              <span className="instrument-value">{stockData.length.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Main workspace ── */}
      <main className="app-workspace">
        {stockData.length === 0 && !loading && (
          <div className="app-empty-state">
            <div className="empty-state-icon">📈</div>
            <div className="empty-state-title">No instrument selected</div>
            <div className="empty-state-sub">
              Search for a ticker symbol above to load chart data, indicators, and AI analysis.
            </div>
          </div>
        )}

        {loading && stockData.length === 0 && (
          <div className="app-empty-state">
            <div className="empty-state-icon">⏳</div>
            <div className="empty-state-title">Loading market data…</div>
          </div>
        )}

        {stockData.length > 0 && (
          <div className="chart-container">
            <StockChart
              stockData={stockData}
              stockSymbol={selectedStock?.symbol}
              currentInterval={currentInterval}
              onIntervalChange={handleIntervalChange}
              aiPrediction={aiPrediction}
            />
          </div>
        )}
      </main>

      <PortfolioDialog isOpen={isPortfolioOpen} onClose={() => setIsPortfolioOpen(false)} />
      <OrdersDialog isOpen={isOrdersOpen} onClose={() => setIsOrdersOpen(false)} />
    </div>
  );
}

export default App;
