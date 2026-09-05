import './App.css'
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import SearchBar from '../component/SearchBar'
import StockChart from '../component/StockChart';
import TradeDialog from '../component/TradeDialog';
import PortfolioDialog from '../component/PortfolioDialog';
import OrdersDialog from '../component/OrdersDialog';
import WatchlistDialog from '../component/WatchlistDialog';
import ScreenerDialog from '../component/ScreenerDialog';
import BacktestDialog from '../component/BacktestDialog';
import AIChat from '../component/AIChat';
import SettingsDialog from '../component/SettingsDialog';
import PanelCloseButton from '../component/PanelCloseButton';
import { isDesktopApp, isGitHubPages } from './environment';
import { generateNvdaMockData } from './mockData';
import { useTranslation } from './i18n/useTranslation';
import { mergeStockData, olderDailyWindow, recentDailyWindow } from './chartLoading';

const RECENT_CACHE_TTL = 5 * 60 * 1000;
const HISTORY_FLOOR_DATE = '1900-01-01';
const SIDEBAR_DEFAULT_WIDTH = 380;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 760;
const SIDEBAR_MIN_MAIN_WIDTH = 320;
const SIDEBAR_KEYBOARD_STEP = 10;
const ACCOUNT_PANEL_DEFAULT_HEIGHT = 280;
const ACCOUNT_PANEL_MIN_HEIGHT = 180;
const ACCOUNT_PANEL_MAX_HEIGHT = 520;
const ACCOUNT_PANEL_MIN_MAIN_HEIGHT = 240;
const ACCOUNT_PANEL_KEYBOARD_STEP = 10;
const APP_TOPBAR_HEIGHT = 56;

function stockDataCacheKey(symbol, interval) {
  return `${String(symbol || '').trim().toUpperCase()}-${interval}`;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function App() {
  const { t, language, setLanguage } = useTranslation();

  const [selectedStock, setSelectedStock] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [currentInterval, setCurrentInterval] = useState('1d');
  const [activeSidebar, setActiveSidebar] = useState(null);
  const [accountPanelTab, setAccountPanelTab] = useState('portfolio');
  const [isAccountPanelOpen, setIsAccountPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [aiPrediction, setAiPrediction] = useState(null);
  const [aiLoadState, setAiLoadState] = useState('idle');
  const [historyLoadState, setHistoryLoadState] = useState('idle');
  const [recentLoadState, setRecentLoadState] = useState('idle');
  const [isMock, setIsMock] = useState(false);
  const [ibConnected, setIbConnected] = useState(false);
  const [fundamentals, setFundamentals] = useState(null);
  const [showFundamentals, setShowFundamentals] = useState(false);
  const [orderModification, setOrderModification] = useState(null);
  const [orderDraft, setOrderDraft] = useState(null);
  const [orderPreview, setOrderPreview] = useState(null);
  const [previewPriceChange, setPreviewPriceChange] = useState(null);
  const [ordersRefreshToken, setOrdersRefreshToken] = useState(0);
  const [backtestTrades, setBacktestTrades] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [accountPanelHeight, setAccountPanelHeight] = useState(ACCOUNT_PANEL_DEFAULT_HEIGHT);
  const [isAccountPanelResizing, setIsAccountPanelResizing] = useState(false);
  const stockDataCacheRef = useRef(new Map());
  const loadAbortRef = useRef(null);
  const orderModificationCommittedRef = useRef(false);
  const sidebarRef = useRef(null);
  const accountPanelRef = useRef(null);
  const accountPanelToggleRef = useRef(null);

  const clampSidebarWidth = useCallback((width) => (
    Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, width),
      Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - SIDEBAR_MIN_MAIN_WIDTH),
    )
  ), []);

  const handleResizerPointerDown = useCallback((e) => {
    e.preventDefault();
    const resizer = e.currentTarget;
    const startX = e.clientX;
    const startWidth = sidebarRef.current?.offsetWidth ?? SIDEBAR_DEFAULT_WIDTH;
    resizer.setPointerCapture(e.pointerId);
    setIsSidebarResizing(true);

    const applyWidth = (width) => {
      const next = clampSidebarWidth(width);
      const aside = sidebarRef.current;
      if (aside) {
        aside.style.width = `${next}px`;
        aside.style.maxWidth = `${next}px`;
      }
      resizer.setAttribute('aria-valuenow', String(next));
      return next;
    };

    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      applyWidth(startWidth + startX - ev.clientX);
    };

    const teardown = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', teardown);
      resizer.removeEventListener('pointercancel', teardown);
      resizer.removeEventListener('lostpointercapture', teardown);
      if (resizer.hasPointerCapture?.(ev.pointerId)) resizer.releasePointerCapture(ev.pointerId);
      const final = Math.round(parseFloat(sidebarRef.current?.style.width) || SIDEBAR_DEFAULT_WIDTH);
      setSidebarWidth(final);
      setIsSidebarResizing(false);
    };

    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', teardown);
    resizer.addEventListener('pointercancel', teardown);
    resizer.addEventListener('lostpointercapture', teardown);
  }, [clampSidebarWidth]);

  const handleResizerKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setSidebarWidth(prev => clampSidebarWidth(prev + (e.key === 'ArrowRight' ? SIDEBAR_KEYBOARD_STEP : -SIDEBAR_KEYBOARD_STEP)));
  }, [clampSidebarWidth]);

  const clampAccountPanelHeight = useCallback((height) => {
    const maxForViewport = Math.max(
      ACCOUNT_PANEL_MIN_HEIGHT,
      window.innerHeight - APP_TOPBAR_HEIGHT - ACCOUNT_PANEL_MIN_MAIN_HEIGHT,
    );
    return Math.min(
      ACCOUNT_PANEL_MAX_HEIGHT,
      Math.max(ACCOUNT_PANEL_MIN_HEIGHT, height),
      maxForViewport,
    );
  }, []);

  const applyAccountPanelHeight = useCallback((height) => {
    const next = clampAccountPanelHeight(height);
    const panel = accountPanelRef.current;
    panel?.style.setProperty('--account-panel-height', `${next}px`);
    panel?.closest('#root')?.style.setProperty('--account-panel-height', `${next}px`);
    return next;
  }, [clampAccountPanelHeight]);

  const handleAccountPanelResizePointerDown = useCallback((event) => {
    event.preventDefault();
    const resizer = event.currentTarget;
    const startY = event.clientY;
    const startHeight = accountPanelRef.current?.offsetHeight ?? ACCOUNT_PANEL_DEFAULT_HEIGHT;
    resizer.setPointerCapture(event.pointerId);
    setIsAccountPanelResizing(true);

    const applyHeight = (height) => {
      const next = applyAccountPanelHeight(height);
      resizer.setAttribute('aria-valuenow', String(next));
    };

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      applyHeight(startHeight + startY - moveEvent.clientY);
    };

    const teardown = (endEvent) => {
      if (endEvent.pointerId !== event.pointerId) return;
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', teardown);
      resizer.removeEventListener('pointercancel', teardown);
      resizer.removeEventListener('lostpointercapture', teardown);
      if (resizer.hasPointerCapture?.(endEvent.pointerId)) resizer.releasePointerCapture(endEvent.pointerId);
      const finalHeight = Math.round(
        parseFloat(accountPanelRef.current?.style.getPropertyValue('--account-panel-height')) || ACCOUNT_PANEL_DEFAULT_HEIGHT,
      );
      setAccountPanelHeight(finalHeight);
      setIsAccountPanelResizing(false);
    };

    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', teardown);
    resizer.addEventListener('pointercancel', teardown);
    resizer.addEventListener('lostpointercapture', teardown);
  }, [applyAccountPanelHeight]);

  const handleAccountPanelResizeKeyDown = useCallback((event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setAccountPanelHeight((height) => clampAccountPanelHeight(
      height + (event.key === 'ArrowUp' ? ACCOUNT_PANEL_KEYBOARD_STEP : -ACCOUNT_PANEL_KEYBOARD_STEP),
    ));
  }, [clampAccountPanelHeight]);

  useEffect(() => {
    const onWindowResize = () => {
      const maxForViewport = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - SIDEBAR_MIN_MAIN_WIDTH);
      setSidebarWidth(prev => Math.min(prev, maxForViewport));
    };
    onWindowResize();
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  useEffect(() => {
    applyAccountPanelHeight(accountPanelHeight);
  }, [accountPanelHeight, applyAccountPanelHeight]);

  useEffect(() => {
    const onWindowResize = () => setAccountPanelHeight((height) => applyAccountPanelHeight(height));
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [applyAccountPanelHeight]);

  const toggleAccountPanel = () => {
    if (!isAccountPanelOpen) {
      setAccountPanelHeight((height) => applyAccountPanelHeight(height));
    }
    setIsAccountPanelOpen((open) => !open);
  };

  const closeAccountPanel = () => {
    setIsAccountPanelOpen(false);
    requestAnimationFrame(() => accountPanelToggleRef.current?.focus());
  };

  const handleAccountTabKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'ArrowRight' || event.key === 'End' ? 'orders' : 'portfolio';
    setAccountPanelTab(nextTab);
    event.currentTarget.parentElement?.querySelector(`#${nextTab}-tab`)?.focus();
  };

  const rememberStockData = (symbol, interval, data, meta = {}) => {
    if (!symbol || !Array.isArray(data) || data.length === 0) return;
    const entry = {
      data,
      recentTimestamp: meta.recentTimestamp ?? Date.now(),
      complete: meta.complete === true,
    };
    stockDataCacheRef.current.set(stockDataCacheKey(symbol, interval), entry);
    return entry;
  };

  const fetchFundamentals = async (stock, signal) => {
    if (isGitHubPages()) return;
    try {
      const data = await fetchJson(`/api/fundamentals/${stock.symbol}`, signal);
      if (!signal.aborted) setFundamentals(data);
    } catch {
      if (!signal.aborted) setFundamentals(null);
    }
  };

  const fetchPrediction = async (symbol, signal) => {
    setAiLoadState('loading');
    try {
      const prediction = await fetchJson(`/api/prediction/${symbol}`, signal);
      if (signal.aborted) return;
      setAiPrediction(prediction);
      setAiLoadState(prediction.status === 'success' ? 'idle' : 'error');
    } catch (fetchError) {
      if (signal.aborted) return;
      setAiPrediction({ status: 'prediction_error', error: fetchError.message });
      setAiLoadState('error');
    }
  };

  const fetchBackfill = async (symbol, interval, seedData, signal, recentTimestamp) => {
    setHistoryLoadState('loading');
    let merged = seedData;
    let beforeDate = merged[0]?.Date;
    let sameWindowAttempts = 0;
    let emptyWindows = 0;

    try {
      while (beforeDate && !signal.aborted) {
        const window = olderDailyWindow(beforeDate);
        const startDate = emptyWindows >= 2 || window.startDate < HISTORY_FLOOR_DATE
          ? HISTORY_FLOOR_DATE
          : window.startDate;
        const endDate = window.endDate;
        const atHistoryFloor = startDate === HISTORY_FLOOR_DATE;
        const params = new URLSearchParams({
          date_range: 'max',
          interval,
          auto_predict: 'false',
          chart_only: 'true',
          start_date: startDate,
          end_date: endDate,
        });
        const batch = await fetchJson(`/api/stock/${symbol}?${params}`, signal);
        if (signal.aborted) return;
        const next = Array.isArray(batch) ? mergeStockData(batch, merged) : merged;
        if (!Array.isArray(batch) || batch.length === 0 || next.length === merged.length) {
          sameWindowAttempts += 1;
          if (sameWindowAttempts < 2) continue;
          sameWindowAttempts = 0;
          if (atHistoryFloor) {
            if (signal.aborted) return;
            rememberStockData(symbol, interval, merged, { recentTimestamp, complete: true });
            if (signal.aborted) return;
            setHistoryLoadState('idle');
            return;
          }
          emptyWindows += 1;
          beforeDate = startDate;
          continue;
        }
        sameWindowAttempts = 0;
        emptyWindows = 0;
        merged = next;
        beforeDate = merged[0].Date;
        if (signal.aborted) return;
        setStockData(merged);
        if (signal.aborted) return;
        const complete = atHistoryFloor;
        rememberStockData(symbol, interval, merged, { recentTimestamp, complete });
        if (complete) {
          if (signal.aborted) return;
          setHistoryLoadState('idle');
          return;
        }
      }

      if (!signal.aborted) setHistoryLoadState('error');
    } catch {
      if (!signal.aborted) setHistoryLoadState('error');
    }
  };

  const fetchStockData = async (stock, interval = '1d', includeFundamentals = false) => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const { signal } = controller;

    setError(null);
    setCurrentInterval(interval);
    setAiPrediction(null);
    setAiLoadState('idle');
    setHistoryLoadState('idle');
    setRecentLoadState('idle');
    if (includeFundamentals) void fetchFundamentals(stock, signal);

    try {
      if (isGitHubPages()) {
        const mockData = generateNvdaMockData();
        setStockData(mockData);
        setIsMock(true);
        const prediction = mockData.find(item => item.prediction)?.prediction;
        if (prediction) setAiPrediction(prediction);
        setLoading(false);
        return;
      }

      const suppliedData = (
        Array.isArray(stock?.chartData) &&
        stock.chartData.length > 0 &&
        stock.chartDataMeta?.interval === interval
      ) ? mergeStockData(stock.chartData) : null;
      const suppliedPrediction = stock?.chartData?.find(item => item.prediction)?.prediction;
      let cached = stockDataCacheRef.current.get(stockDataCacheKey(stock.symbol, interval));

      if (suppliedData?.length) {
        cached = rememberStockData(stock.symbol, interval, suppliedData, {
          complete: stock.chartDataMeta?.dateRange === 'max',
        });
        if (suppliedPrediction) setAiPrediction(suppliedPrediction);
      }

      setIsMock(false);
      if (cached?.data?.length) {
        setStockData(cached.data);
        setLoading(false);
      } else {
        setStockData([]);
        setLoading(true);
      }

      const cacheIsFresh = cached
        && Date.now() - cached.recentTimestamp < RECENT_CACHE_TTL;
      let loaded = cached;

      if (!cacheIsFresh) {
        const params = new URLSearchParams({
          date_range: interval === '1d' ? '2y' : 'max',
          interval,
          auto_predict: 'false',
          chart_only: 'true',
        });
        if (interval === '1d') {
          const { startDate, endDate } = recentDailyWindow();
          params.set('start_date', startDate);
          params.set('end_date', endDate);
        }

        const recent = await fetchJson(`/api/stock/${stock.symbol}?${params}`, signal);
        if (signal.aborted) return;
        if (!Array.isArray(recent) || recent.length === 0) {
          throw new Error(t('noDataFound', { symbol: stock.symbol }));
        }

        const merged = mergeStockData(cached?.data, recent);
        loaded = rememberStockData(stock.symbol, interval, merged, {
          complete: interval !== '1d' || cached?.complete,
        });
        setStockData(merged);
        setLoading(false);
      }

      if (signal.aborted || !loaded?.data?.length) return;
      void fetchPrediction(stock.symbol, signal);
      if (interval === '1d' && !loaded.complete) {
        void fetchBackfill(
          stock.symbol,
          interval,
          loaded.data,
          signal,
          loaded.recentTimestamp,
        );
      }
    } catch (fetchError) {
      if (signal.aborted) return;
      console.error('Error fetching stock data:', fetchError);
      const fallback = stockDataCacheRef.current.get(stockDataCacheKey(stock.symbol, interval));
      if (fallback?.data?.length) {
        setRecentLoadState('error');
        void fetchPrediction(stock.symbol, signal);
        if (interval === '1d' && !fallback.complete) {
          void fetchBackfill(stock.symbol, interval, fallback.data, signal, fallback.recentTimestamp);
        }
      } else {
        setStockData([]);
        setError(fetchError.message || t('failedToLoadStockData'));
      }
      setLoading(false);
    }
  };

  const handleStockSelect = (stock) => {
    setOrderDraft(null);
    setSelectedStock(stock);
    setError(null);
    setAiPrediction(null);
    setFundamentals(null);
    setShowFundamentals(false);
    setBacktestTrades(null);
    void fetchStockData(stock, currentInterval, true);
  };

  const handleIntervalChange = (interval) => {
    setBacktestTrades(null);
    if (selectedStock) {
      void fetchStockData(selectedStock, interval);
    }
  };

  useEffect(() => () => loadAbortRef.current?.abort(), []);

  const handleOrderPriceDrag = useCallback((order, price) => {
    orderModificationCommittedRef.current = false;
    setOrderDraft(null);
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
    setOrderDraft(null);
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
    setOrderDraft(null);
    setOrderModification(null);
    setActiveSidebar(prev => (prev === 'trade' && !orderModification ? null : 'trade'));
  }, [orderModification]);

  const handleReviewDraft = (draft) => {
    if (orderModification && !orderModificationCommittedRef.current) {
      setOrdersRefreshToken(token => token + 1);
    }
    orderModificationCommittedRef.current = false;
    setOrderModification(null);
    if (selectedStock?.symbol !== draft.symbol) {
      void handleStockSelect({ symbol: draft.symbol });
    }
    setOrderDraft(draft);
    setActiveSidebar('trade');
  };

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
            className={`btn-screener${activeSidebar === 'screener' ? ' is-active' : ''}`}
            onClick={() => setActiveSidebar(prev => prev === 'screener' ? null : 'screener')}
            aria-label={t('screener')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18"/>
            </svg>
            {t('screener')}
          </button>
          <button
            className={`btn-backtest${activeSidebar === 'backtest' ? ' is-active' : ''}`}
            onClick={() => setActiveSidebar(prev => prev === 'backtest' ? null : 'backtest')}
            aria-label={t('backtest')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            {t('backtest')}
          </button>
          <button
            className={`btn-watchlist${activeSidebar === 'watchlist' ? ' is-active' : ''}`}
            onClick={() => setActiveSidebar(prev => prev === 'watchlist' ? null : 'watchlist')}
            aria-label={t('watchlist')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
            </svg>
            {t('watchlist')}
          </button>
          <button
            ref={accountPanelToggleRef}
            className={`btn-portfolio${isAccountPanelOpen ? ' is-active' : ''}`}
            onClick={toggleAccountPanel}
            aria-label={`${t('portfolio')} / ${t('orders')}`}
            aria-expanded={isAccountPanelOpen}
            aria-controls="account-panel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
            </svg>
            {t('portfolio')}
          </button>

          <div className="topbar-divider" />

          {isDesktopApp() && (
            <button
              className={`btn-orders${activeSidebar === 'settings' ? ' is-active' : ''}`}
              onClick={() => setActiveSidebar(prev => prev === 'settings' ? null : 'settings')}
              aria-label={t('settings')}
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.38.42.72.75.96.3.22.67.34 1.05.34h.09v4h-.09c-.38 0-.75.12-1.05.34-.33.24-.59.58-.75.96Z" />
              </svg>
              {t('settings')}
            </button>
          )}

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

              {(aiLoadState !== 'idle' || historyLoadState !== 'idle' || recentLoadState !== 'idle') && (
                <div className="chart-load-status" role="status" aria-live="polite">
                  {aiLoadState === 'loading' && <span>{t('aiAnalyzing')}</span>}
                  {aiLoadState === 'error' && <span className="is-warning">{t('aiUnavailable')}</span>}
                  {historyLoadState === 'loading' && <span>{t('loadingOlderHistory')}</span>}
                  {historyLoadState === 'error' && <span className="is-warning">{t('historyPartiallyLoaded')}</span>}
                  {recentLoadState === 'error' && <span className="is-warning">{t('recentRefreshFailed')}</span>}
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
                  orderPreview={activeSidebar === 'trade' ? orderPreview : null}
                  onPreviewPriceDrag={setPreviewPriceChange}
                  ibConnected={ibConnected}
                  ordersRefreshToken={ordersRefreshToken}
                  backtestTrades={backtestTrades}
                />
              </div>
            )}
          </main>

          <section
            ref={accountPanelRef}
            id="account-panel"
            className={`account-panel${isAccountPanelOpen ? '' : ' account-panel-hidden'}${isAccountPanelResizing ? ' account-panel-resizing' : ''}`}
            aria-label={`${t('portfolio')} / ${t('orders')}`}
            aria-hidden={!isAccountPanelOpen}
            inert={!isAccountPanelOpen}
          >
            <div
              className="account-panel-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label={t('resizeAccountPanel')}
              aria-valuemin={ACCOUNT_PANEL_MIN_HEIGHT}
              aria-valuemax={Math.min(
                ACCOUNT_PANEL_MAX_HEIGHT,
                Math.max(ACCOUNT_PANEL_MIN_HEIGHT, window.innerHeight - APP_TOPBAR_HEIGHT - ACCOUNT_PANEL_MIN_MAIN_HEIGHT),
              )}
              aria-valuenow={accountPanelHeight}
              tabIndex={isAccountPanelOpen ? 0 : -1}
              onPointerDown={handleAccountPanelResizePointerDown}
              onKeyDown={handleAccountPanelResizeKeyDown}
            />
            <div className="account-panel-bar">
              <div className="account-panel-tabs" role="tablist" aria-label={`${t('portfolio')} / ${t('orders')}`}>
                <button
                  id="portfolio-tab"
                  className="account-panel-tab"
                  role="tab"
                  aria-selected={accountPanelTab === 'portfolio'}
                  aria-controls="portfolio-dialog-sidebar"
                  tabIndex={isAccountPanelOpen && accountPanelTab === 'portfolio' ? 0 : -1}
                  onClick={() => setAccountPanelTab('portfolio')}
                  onKeyDown={handleAccountTabKeyDown}
                >
                  {t('portfolio')}
                </button>
                <button
                  id="orders-tab"
                  className="account-panel-tab"
                  role="tab"
                  aria-selected={accountPanelTab === 'orders'}
                  aria-controls="orders-dialog-sidebar"
                  tabIndex={isAccountPanelOpen && accountPanelTab === 'orders' ? 0 : -1}
                  onClick={() => setAccountPanelTab('orders')}
                  onKeyDown={handleAccountTabKeyDown}
                >
                  {t('orders')}
                </button>
              </div>
              <PanelCloseButton
                onClick={closeAccountPanel}
                label={accountPanelTab === 'portfolio' ? t('closePortfolio') : t('closeOrders')}
              />
            </div>
            <div className="account-panel-content">
              <PortfolioDialog
                isOpen={isAccountPanelOpen && accountPanelTab === 'portfolio'}
                onStockSelect={handleStockSelect}
              />
              <OrdersDialog
                isOpen={isAccountPanelOpen && accountPanelTab === 'orders'}
                onStockSelect={handleStockSelect}
              />
            </div>
          </section>
        </div>

        <aside
          ref={sidebarRef}
          className={`app-sidebar${activeSidebar ? '' : ' app-sidebar-hidden'}${isSidebarResizing ? ' app-sidebar-resizing' : ''}`}
          style={activeSidebar ? { width: `${sidebarWidth}px`, maxWidth: `${sidebarWidth}px` } : undefined}
        >
          <div
            className="app-sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('resizeSidebar')}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - SIDEBAR_MIN_MAIN_WIDTH)}
            aria-valuenow={sidebarWidth}
            aria-hidden={!activeSidebar || undefined}
            tabIndex={activeSidebar ? 0 : -1}
            onPointerDown={handleResizerPointerDown}
            onKeyDown={handleResizerKeyDown}
          />
          <TradeDialog
            isOpen={activeSidebar === 'trade'}
            onClose={handleTradeClose}
            stockSymbol={selectedStock?.symbol}
            ibConnected={ibConnected}
            modification={orderModification}
            draft={orderDraft}
            onModificationPriceChange={handleOrderModificationPriceChange}
            onModified={handleOrderModified}
            onPreviewChange={setOrderPreview}
            previewPriceChange={previewPriceChange}
            currentPrice={loading ? null : latestClose}
          />
          <WatchlistDialog isOpen={activeSidebar === 'watchlist'} onClose={() => setActiveSidebar(null)} onStockSelect={handleStockSelect} />
          <ScreenerDialog
            isOpen={activeSidebar === 'screener'}
            onClose={() => setActiveSidebar(null)}
            onStockSelect={handleStockSelect}
            onStockDataScanned={(symbol, data, meta) => rememberStockData(
              symbol,
              meta?.interval || '1d',
              data,
              { complete: meta?.dateRange === 'max' },
            )}
          />
          <BacktestDialog
            isOpen={activeSidebar === 'backtest'}
            onClose={() => setActiveSidebar(null)}
            selectedSymbol={selectedStock?.symbol}
            currentInterval={currentInterval}
            onTradesUpdate={setBacktestTrades}
          />
          <SettingsDialog isOpen={activeSidebar === 'settings'} onClose={() => setActiveSidebar(null)} />
        </aside>
      </div>

      {!isMock && (
        <AIChat
          accountPanelOpen={isAccountPanelOpen}
          stockSymbol={selectedStock?.symbol}
          stockData={stockData}
          currentInterval={currentInterval}
          fundamentals={fundamentals}
          aiPrediction={aiPrediction}
          onReviewDraft={handleReviewDraft}
        />
      )}
    </div>
  );
}

export default App;
