import './App.css'
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import SearchBar from '../component/SearchBar'
import StockChart from '../component/StockChart';
import TradeDialog from '../component/TradeDialog';
import PortfolioDialog from '../component/PortfolioDialog';
import OrdersDialog from '../component/OrdersDialog';
import WatchlistDialog from '../component/WatchlistDialog';
import ScreenerDialog from '../component/ScreenerDialog';
import { isGitHubPages } from './environment';
import { generateNvdaMockData } from './mockData';
import { useTranslation } from './i18n/useTranslation';

function App() {
  const { t, language, setLanguage } = useTranslation();

  const [selectedStock, setSelectedStock] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [currentInterval, setCurrentInterval] = useState('1d');
  const [activeSidebar, setActiveSidebar] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [aiPrediction, setAiPrediction] = useState(null);
  const [isMock, setIsMock] = useState(false);
  const [ibConnected, setIbConnected] = useState(false);
  const [fundamentals, setFundamentals] = useState(null);
  const [showFundamentals, setShowFundamentals] = useState(false);
  const [orderModification, setOrderModification] = useState(null);
  const [ordersRefreshToken, setOrdersRefreshToken] = useState(0);
  const stockDataCacheRef = useRef(new Map());
  const orderModificationCommittedRef = useRef(false);

  // Use '2y' as the default date_range — 'max' can return 40+ years of data
  // for popular symbols (10,000+ rows), which dramatically slows down yfinance
  // download, feature computation, serialization, transfer, and chart rendering.
  // 2 years (~500 trading days) is more than sufficient for chart display and
  // still provides ample data for ML feature computation (200MA needs ~200 days).
  const DEFAULT_DATE_RANGE = '2y';

  const getStockDataCacheKey = useCallback((symbol, interval = '1d', autoPredict = false) => {
    return `${String(symbol || '').trim().toUpperCase()}-${DEFAULT_DATE_RANGE}-${interval}-${autoPredict ? 'true' : 'false'}`;
  }, []);

  const rememberStockData = useCallback((symbol, data, meta = {}) => {
    if (!symbol || !Array.isArray(data) || data.length === 0) return;

    const key = getStockDataCacheKey(symbol, meta.interval || '1d', meta.autoPredict === true);
    stockDataCacheRef.current.set(key, {
      data,
      timestamp: Date.now(),
    });
  }, [getStockDataCacheKey]);

  const fetchStockData = async (stock, interval = '1d', autoPredictEnabled = true) => {
    setLoading(true);
    setError(null);
    try {
      // On GitHub Pages: use mock NVDA data (ignores the searched symbol)
      if (isGitHubPages()) {
        const mockData = generateNvdaMockData();
        setStockData(mockData);
        setCurrentInterval(interval);
        setIsMock(true);
        const prediction = mockData.find(item => item.prediction)?.prediction;
        if (prediction) setAiPrediction(prediction);
        return;
      }

      if (
        Array.isArray(stock?.chartData) &&
        stock.chartData.length > 0 &&
        stock.chartDataMeta?.interval === interval
      ) {
        setStockData(stock.chartData);
        setCurrentInterval(interval);
        setIsMock(false);
        rememberStockData(stock.symbol, stock.chartData, stock.chartDataMeta);
        const prediction = stock.chartData.find(item => item.prediction)?.prediction;
        if (prediction) setAiPrediction(prediction);
        return;
      }

      const cached = !autoPredictEnabled
        ? stockDataCacheRef.current.get(getStockDataCacheKey(stock.symbol, interval, false))
        : null;

      if (cached?.data?.length > 0) {
        setStockData(cached.data);
        setCurrentInterval(interval);
        setIsMock(false);
        const prediction = cached.data.find(item => item.prediction)?.prediction;
        if (prediction) setAiPrediction(prediction);
        return;
      }

      // Normal API call (local dev)
      const autoPredictParam = autoPredictEnabled ? 'true' : 'false';
      const response = await fetch(
        `/api/stock/${stock.symbol}?date_range=${DEFAULT_DATE_RANGE}&interval=${interval}&auto_predict=${autoPredictParam}`
      );
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || t('failedToLoadStockData'));
      }
      if (Array.isArray(data) && data.length > 0) {
        setStockData(data);
        setCurrentInterval(interval);
        setIsMock(false);
        rememberStockData(stock.symbol, data, { interval, autoPredict: autoPredictEnabled });
        // Only update the prediction when the API actually returned one.
        // This keeps the last known prediction visible during interval changes.
        const prediction = data.find(item => item.prediction)?.prediction;
        if (prediction) setAiPrediction(prediction);
      } else {
        throw new Error(`No data found for ${stock.symbol}`);
      }
    } catch (fetchError) {
      console.error('Error fetching stock data:', fetchError);
      setStockData([]);
      setError(fetchError.message || t('failedToLoadStockData'));
    } finally {
      setLoading(false);
    }
  };

  const fetchFundamentals = async (stock) => {
    if (isGitHubPages()) return;
    try {
      const res = await fetch(`/api/fundamentals/${stock.symbol}`);
      const data = await res.json();
      if (res.ok && !data.error) {
        setFundamentals(data);
      } else {
        setFundamentals(null);
      }
    } catch {
      setFundamentals(null);
    }
  };

  const handleStockSelect = async (stock) => {
    setSelectedStock(stock);
    setStockData([]);
    setError(null);
    setAiPrediction(null);
    setFundamentals(null);
    setShowFundamentals(false);
    // Fire both requests in parallel — fundamentals don't depend on stock data
    await Promise.all([
      fetchStockData(stock, currentInterval),
      fetchFundamentals(stock),
    ]);
  };

  const handleIntervalChange = async (interval) => {
    if (selectedStock) {
      await fetchStockData(selectedStock, interval, false);
    }
  };

  const handleOrderPriceDrag = useCallback((order, price) => {
    orderModificationCommittedRef.current = false;
    setOrderModification({ order, price });
    setActiveSidebar('trade');
  }, []);

  const handleOrderModified = useCallback(() => {
    orderModificationCommittedRef.current = true;
    setOrdersRefreshToken(prev => prev + 1);
  }, []);

  const handleOrderModificationPriceChange = useCallback((price) => {
    setOrderModification(prev => prev ? { ...prev, price } : prev);
  }, []);

  const handleTradeClose = useCallback(() => {
    setActiveSidebar(null);
    setOrderModification(prev => {
      if (prev && !orderModificationCommittedRef.current) {
        setOrdersRefreshToken(token => token + 1);
      }
      orderModificationCommittedRef.current = false;
      return null;
    });
  }, []);

  const handleTradeButtonClick = useCallback(() => {
    if (orderModification && !orderModificationCommittedRef.current) {
      setOrdersRefreshToken(token => token + 1);
    }

    orderModificationCommittedRef.current = false;
    setOrderModification(null);
    setActiveSidebar(prev => (prev === 'trade' && !orderModification ? null : 'trade'));
  }, [orderModification]);

  // Derive latest close from stockData for the instrument header
  const latestClose = useMemo(() => {
    if (!stockData || stockData.length === 0) return null;
    const item = [...stockData].reverse().find(d => d.Close != null);
    return item ? (Math.round(parseFloat(item.Close) * 100) / 100) : null;
  }, [stockData]);

  // Poll IB Gateway connection status
  useEffect(() => {
    if (isGitHubPages()) return;

    const checkStatus = async () => {
      try {
        const res = await fetch('/api/ib/status');
        const data = await res.json();
        setIbConnected(data.connected === true);
      } catch {
        setIbConnected(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div id="root">
      {/* ── Top nav bar ── */}
      <header className="app-topbar">
        <div className="app-brand">
           <div className="app-brand-icon">S</div>
           <span className="app-brand-name">{t('brandName')}</span>
         </div>

        <div className="topbar-divider" />

        <div className="topbar-search">
          <SearchBar onStockSelect={handleStockSelect} loading={loading} />
        </div>

        <div className="topbar-actions">
          <button
            className="btn-screener"
            onClick={() => setActiveSidebar(prev => prev === 'screener' ? null : 'screener')}
            aria-label={t('screener')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18"/>
            </svg>
            {t('screener')}
          </button>
          <button
            className="btn-watchlist"
            onClick={() => setActiveSidebar(prev => prev === 'watchlist' ? null : 'watchlist')}
            aria-label={t('watchlist')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
            </svg>
            {t('watchlist')}
          </button>
          <button
            className="btn-portfolio"
            onClick={() => setActiveSidebar(prev => prev === 'portfolio' ? null : 'portfolio')}
            aria-label={t('portfolio')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
            </svg>
            {t('portfolio')}
          </button>
          <button
            className="btn-orders"
            onClick={() => setActiveSidebar(prev => prev === 'orders' ? null : 'orders')}
            aria-label={t('orders')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            {t('orders')}
          </button>

          <div className="topbar-divider" />

          <button
            className="btn-language"
            onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            aria-label={t('language')}
            title={language === 'en' ? t('traditionalChinese') : t('english')}
          >
            {language === 'en' ? 'EN' : '繁'}
          </button>
        </div>
      </header>

      <div className="app-body">
        <div className="app-main">
          {/* ── Instrument header (shows once symbol is loaded) ── */}
          {selectedStock && (
            <div className="instrument-header">
              {isMock && (
                <span className="mock-badge">{t('demo')}</span>
              )}
              <span className="instrument-symbol">{selectedStock.symbol}</span>

              {latestClose != null && (
                <span className="instrument-price">
                  ${latestClose.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}

              <div className="instrument-stat">
                <span className="instrument-label">{t('interval')}</span>
                <span className="instrument-value">
                  {currentInterval === '1d' ? t('daily') : currentInterval === '1wk' ? t('weekly') : t('monthly')}
                </span>
              </div>

              {aiPrediction && aiPrediction.status === 'success' && (
                <div className="instrument-stat">
                  <span className="instrument-label">{t('aiSignal')}</span>
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
                  <span className="instrument-label">{t('dataPoints')}</span>
                  <span className="instrument-value">{stockData.length.toLocaleString()}</span>
                </div>
              )}

              {fundamentals && (
                <button
                  className="btn-fundamentals-toggle"
                  onClick={() => setShowFundamentals((p) => !p)}
                  aria-label={showFundamentals ? t('hideFundamentals') : t('showFundamentals')}
                >
                  {t('fundamentals')}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showFundamentals ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* ── Fundamentals panel ── */}
          {selectedStock && showFundamentals && fundamentals && (
            <div className="fundamentals-panel">
              <div className="fundamentals-grid">
                {fundamentals.marketCap != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('marketCap')}</span>
                    <span className="fundamentals-value">{fundamentals.marketCap}</span>
                  </div>
                )}
                {fundamentals.trailingPE != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('peRatio')}</span>
                    <span className="fundamentals-value">{fundamentals.trailingPE}</span>
                  </div>
                )}
                {fundamentals.forwardPE != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('forwardPE')}</span>
                    <span className="fundamentals-value">{fundamentals.forwardPE}</span>
                  </div>
                )}
                {fundamentals.trailingEps != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('eps')}</span>
                    <span className="fundamentals-value">{fundamentals.trailingEps}</span>
                  </div>
                )}
                {fundamentals.dividendYield != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('dividendYield')}</span>
                    <span className="fundamentals-value">{fundamentals.dividendYield}</span>
                  </div>
                )}
                {fundamentals.sector != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('sector')}</span>
                    <span className="fundamentals-value">{fundamentals.sector}</span>
                  </div>
                )}
                {fundamentals.beta != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('beta')}</span>
                    <span className="fundamentals-value">{fundamentals.beta}</span>
                  </div>
                )}
                {fundamentals.week52Range != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('week52Range')}</span>
                    <span className="fundamentals-value">{fundamentals.week52Range}</span>
                  </div>
                )}
                {fundamentals.averageVolume != null && (
                  <div className="fundamentals-item">
                    <span className="fundamentals-label">{t('avgVolume')}</span>
                    <span className="fundamentals-value">{fundamentals.averageVolume}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Main workspace ── */}
          <main className="app-workspace">
            {stockData.length === 0 && !loading && !error && !selectedStock && (
              <div className="app-empty-state">
                <div className="empty-state-icon">📈</div>
                <div className="empty-state-title">{t('noInstrumentSelected')}</div>
                <div className="empty-state-sub">
                  {t('searchForTicker')}
                </div>
              </div>
            )}

            {stockData.length === 0 && !loading && !error && selectedStock && (
              <div className="app-empty-state">
                <div className="empty-state-icon">📭</div>
                <div className="empty-state-title">{t('noDataFound', { symbol: selectedStock.symbol })}</div>
                <div className="empty-state-sub">
                  {t('checkTicker')}
                </div>
              </div>
            )}

            {stockData.length === 0 && !loading && error && (
              <div className="app-empty-state">
                <div className="empty-state-icon">⚠️</div>
                <div className="empty-state-title">{t('unableToLoad', { symbol: selectedStock?.symbol || t('failedToLoadStockData') })}</div>
                <div className="empty-state-sub">{error}</div>
              </div>
            )}

            {loading && stockData.length === 0 && (
              <div className="app-empty-state">
                <div className="empty-state-icon">⏳</div>
                <div className="empty-state-title">{t('loadingMarketData')}</div>
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
                  onTradeClick={handleTradeButtonClick}
                  onOrderPriceDrag={handleOrderPriceDrag}
                  orderModification={orderModification}
                  ibConnected={ibConnected}
                  ordersRefreshToken={ordersRefreshToken}
                />
              </div>
            )}
          </main>
        </div>

        <aside className={`app-sidebar${activeSidebar ? '' : ' app-sidebar-hidden'}`}>
          <TradeDialog
            isOpen={activeSidebar === 'trade'}
            onClose={handleTradeClose}
            stockSymbol={selectedStock?.symbol}
            ibConnected={ibConnected}
            modification={orderModification}
            onModificationPriceChange={handleOrderModificationPriceChange}
            onModified={handleOrderModified}
          />
          <PortfolioDialog isOpen={activeSidebar === 'portfolio'} onClose={() => setActiveSidebar(null)} onStockSelect={handleStockSelect} />
          <OrdersDialog isOpen={activeSidebar === 'orders'} onClose={() => setActiveSidebar(null)} onStockSelect={handleStockSelect} />
          <WatchlistDialog isOpen={activeSidebar === 'watchlist'} onClose={() => setActiveSidebar(null)} onStockSelect={handleStockSelect} />
          <ScreenerDialog
            isOpen={activeSidebar === 'screener'}
            onClose={() => setActiveSidebar(null)}
            onStockSelect={handleStockSelect}
            onStockDataScanned={rememberStockData}
          />
        </aside>
      </div>
    </div>
  );
}

export default App;
