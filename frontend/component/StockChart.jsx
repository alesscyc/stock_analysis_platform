import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import TradeDialog from './TradeDialog';
import './StockChart.css';

// ── MA config: key → display label and colour ─────────────
const MA_CONFIG = [
  { key: '200MA', label: '200 MA', color: '#e0e0e0' },
  { key: '150MA', label: '150 MA', color: '#f0e040' },
  { key:  '50MA', label:  '50 MA', color: '#4488ff' },
  { key:  '20MA', label:  '20 MA', color: '#00e5c8' },
  { key:  '10MA', label:  '10 MA', color: '#ff5555' },
];

// Parse a "YYYY-MM-DD" or ISO date string to 'YYYY-MM-DD' string
// lightweight-charts expects time as 'YYYY-MM-DD' business-day strings
// or unix timestamps (seconds). We use the string form.
function toChartDate(raw) {
  if (!raw) return null;
  // Accept "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS..." or epoch ms
  if (typeof raw === 'number') {
    // epoch milliseconds → YYYY-MM-DD
    const d = new Date(raw);
    return d.toISOString().slice(0, 10);
  }
  // trim any time portion
  return String(raw).slice(0, 10);
}

function StockChart({ stockData, stockSymbol, currentInterval, onIntervalChange, aiPrediction }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);

  // series refs — held outside React state so we don't trigger re-renders
  const candleSeriesRef  = useRef(null);
  const volumeSeriesRef  = useRef(null);
  const maSeriesRefs     = useRef({});

  const [isTradeDialogOpen, setIsTradeDialogOpen] = useState(false);
  const [maVisibility, setMaVisibility] = useState(() =>
    Object.fromEntries(MA_CONFIG.map(m => [m.key, true]))
  );

  const intervals = [
    { value: '1d',  label: 'Daily'   },
    { value: '1wk', label: 'Weekly'  },
    { value: '1mo', label: 'Monthly' },
  ];

  // ── Derived values used outside the chart ────────────────
  const latestClose = useMemo(() => {
    if (!stockData || stockData.length === 0) return null;
    const item = [...stockData].reverse().find(d => d.Close != null);
    return item ? Math.round(parseFloat(item.Close) * 100) / 100 : null;
  }, [stockData]);

  // ── Transform raw API data into series arrays ────────────
  const { candleData, volumeData, maData } = useMemo(() => {
    if (!stockData || stockData.length === 0) {
      return { candleData: [], volumeData: [], maData: {} };
    }

    const candle  = [];
    const volume  = [];
    const ma      = Object.fromEntries(MA_CONFIG.map(m => [m.key, []]));

    for (const item of stockData) {
      const time  = toChartDate(item.Date);
      if (!time) continue;

      const open  = parseFloat(item.Open);
      const high  = parseFloat(item.High);
      const low   = parseFloat(item.Low);
      const close = parseFloat(item.Close);
      const vol   = parseInt(item.Volume, 10);

      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;

      candle.push({
        time,
        open:  Math.round(open  * 100) / 100,
        high:  Math.round(high  * 100) / 100,
        low:   Math.round(low   * 100) / 100,
        close: Math.round(close * 100) / 100,
      });

      const isUp = close >= open;
      volume.push({
        time,
        value: isNaN(vol) ? 0 : vol,
        color: isUp ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      });

      for (const { key } of MA_CONFIG) {
        const raw = item[key];
        if (raw != null && raw !== '') {
          const v = Math.round(parseFloat(raw) * 100) / 100;
          if (!isNaN(v)) ma[key].push({ time, value: v });
        }
      }
    }

    return { candleData: candle, volumeData: volume, maData: ma };
  }, [stockData]);

  // ── Compute initial visible range ────────────────────────
  const visibleRange = useMemo(() => {
    if (!candleData || candleData.length === 0) return null;
    let count;
    switch (currentInterval) {
      case '1wk': count = 260; break;
      case '1mo': count = 120; break;
      default:    count = 252;
    }
    const from = candleData[Math.max(0, candleData.length - count)].time;
    const to   = candleData[candleData.length - 1].time;
    return { from, to };
  }, [candleData, currentInterval]);

  // ── Create / destroy chart on mount / unmount ────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background:  { color: '#131722' },
        textColor:   '#8892a4',
        fontFamily:  "'Inter', 'Helvetica Neue', Arial, sans-serif",
        fontSize:    12,
      },
      grid: {
        vertLines: { color: '#1e2336' },
        horzLines: { color: '#1e2336' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color:       '#4a5170',
          labelBackgroundColor: '#1c2030',
        },
        horzLine: {
          color:       '#4a5170',
          labelBackgroundColor: '#1c2030',
        },
      },
      rightPriceScale: {
        borderColor:   '#2a2f45',
        textColor:     '#8892a4',
        scaleMargins:  { top: 0.05, bottom: 0.25 },
      },
      timeScale: {
        borderColor:    '#2a2f45',
        timeVisible:    false,
        secondsVisible: false,
        rightOffset:    10,
        barSpacing:     6,
      },
      // No built-in tooltip needed — user specified none
      handleScroll: true,
      handleScale:  true,
    });

    chartRef.current = chart;

    // ── Candlestick series ──────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:          '#26a69a',
      downColor:        '#ef5350',
      borderUpColor:    '#26a69a',
      borderDownColor:  '#ef5350',
      wickUpColor:      '#26a69a',
      wickDownColor:    '#ef5350',
      priceScaleId:     'right',
    });
    candleSeriesRef.current = candleSeries;

    // ── Volume histogram on an overlay price scale ──────────
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat:  { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // ── MA line series ──────────────────────────────────────
    maSeriesRefs.current = {};
    for (const { key, color } of MA_CONFIG) {
      const maSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth:    2,
        priceScaleId: 'right',
        crosshairMarkerVisible: false,
        lastValueVisible:       false,
        priceLineVisible:       false,
      });
      maSeriesRefs.current[key] = maSeries;
    }

    // ── Resize observer ─────────────────────────────────────
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.resize(width, height);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current  = null;
      volumeSeriesRef.current  = null;
      maSeriesRefs.current     = {};
    };
  }, []); // only on mount/unmount

  // ── Feed data into series whenever stockData changes ─────
  useEffect(() => {
    if (!candleSeriesRef.current || candleData.length === 0) return;

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current?.setData(volumeData);

    for (const { key } of MA_CONFIG) {
      maSeriesRefs.current[key]?.setData(maData[key] ?? []);
    }

    // Set initial visible range
    if (visibleRange) {
      chartRef.current?.timeScale().setVisibleRange(visibleRange);
    }
  }, [candleData, volumeData, maData, latestClose, visibleRange]);

  // ── Sync MA visibility with series ───────────────────────
  useEffect(() => {
    for (const { key } of MA_CONFIG) {
      const series = maSeriesRefs.current[key];
      if (!series) continue;
      // Lightweight Charts v5: applyOptions with visible flag
      series.applyOptions({ visible: maVisibility[key] });
    }
  }, [maVisibility]);

  // ── MA toggle handler ────────────────────────────────────
  const handleMAToggle = useCallback((key) => {
    setMaVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!stockData || stockData.length === 0) {
    return <div>No stock data available</div>;
  }

  return (
    <div id="stock-chart-root">
      {/* ── Controls bar ── */}
      <div id="stock-chart-controls">
        {/* Left side */}
        <div id="stock-chart-controls-left">
          {/* Interval selector */}
          <div id="interval-selector">
            {intervals.map(iv => (
              <button
                key={iv.value}
                onClick={() => onIntervalChange(iv.value)}
                className={`interval-btn${currentInterval === iv.value ? ' active' : ''}`}
              >
                {iv.label}
              </button>
            ))}
          </div>

          {/* AI Recommendation */}
          {aiPrediction && (
            <div
              id="ai-recommendation"
              className={
                aiPrediction.status === 'success'
                  ? aiPrediction.recommendation === 'BUY' ? 'ai-buy' : 'ai-sell'
                  : 'ai-warning'
              }
            >
              <span id="ai-recommendation-label">AI:</span>
              {aiPrediction.status === 'success' ? (
                <>
                  <span
                    id="ai-recommendation-action"
                    className={aiPrediction.recommendation === 'BUY' ? 'buy' : 'sell'}
                  >
                    {aiPrediction.recommendation}
                  </span>
                  <span id="ai-recommendation-confidence">
                    ({aiPrediction.confidence}% confidence)
                  </span>
                </>
              ) : (
                <span id="ai-recommendation-unavailable">
                  {aiPrediction.status === 'insufficient_data'
                    ? 'Insufficient data for prediction'
                    : aiPrediction.status === 'prediction_error'
                    ? 'Prediction failed'
                    : 'AI unavailable'}
                </span>
              )}
            </div>
          )}

          <button id="trade-btn" onClick={() => setIsTradeDialogOpen(true)}>
            Trade
          </button>
        </div>

        {/* Right side — MA toggles */}
        <div id="ma-controls">
          <span id="ma-controls-label">Moving Averages:</span>
          {MA_CONFIG.map(({ key, label, color }) => (
            <label key={key} className="ma-checkbox-label">
              <input
                type="checkbox"
                checked={maVisibility[key]}
                onChange={() => handleMAToggle(key)}
              />
              <span className="ma-checkbox-text" style={{ color }}>
                {label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ── Chart canvas ── */}
      <div id="stock-chart-canvas-wrapper">
        <div ref={containerRef} id="lw-chart-container" />
      </div>

      <TradeDialog
        isOpen={isTradeDialogOpen}
        onClose={() => setIsTradeDialogOpen(false)}
        stockSymbol={stockSymbol}
      />
    </div>
  );
}

export default StockChart;
