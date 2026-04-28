import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import usePersistedState from '../src/hooks/usePersistedState';
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

// ── Swing Zones Primitive (custom canvas box drawing) ──────
// lightweight-charts v5 uses ISeriesPrimitive for custom overlays.
// This draws semi-transparent rectangles between consecutive swing points.
function createSwingZonesPrimitive() {
  let zones = [];
  let chart = null;
  let series = null;
  let requestUpdate = null;

  return {
    setZones(newZones) {
      zones = newZones;
      requestUpdate?.();
    },

    attached(params) {
      chart = params.chart;
      series = params.series;
      requestUpdate = params.requestUpdate;
    },

    detached() {
      chart = null;
      series = null;
      requestUpdate = null;
    },

    paneViews() {
      return [{
        zOrder: () => 'bottom',
        renderer: () => ({
          draw: (target) => {
            if (!chart || !series || !zones || zones.length === 0) return;

            const timeScale = chart.timeScale();
            target.useBitmapCoordinateSpace(scope => {
              const ctx = scope.context;
              const hr = scope.horizontalPixelRatio;
              const vr = scope.verticalPixelRatio;

              for (const z of zones) {
                const x1 = timeScale.timeToCoordinate(z.time1);
                const x2 = timeScale.timeToCoordinate(z.time2);
                const y1 = series.priceToCoordinate(z.price1);
                const y2 = series.priceToCoordinate(z.price2);

                if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

                const left = Math.min(x1, x2) * hr;
                const top  = Math.min(y1, y2) * vr;
                const width  = Math.abs(x2 - x1) * hr;
                const height = Math.abs(y2 - y1) * vr;

                if (width < 1 || height < 1) continue;

                ctx.strokeStyle = 'rgba(240, 180, 41, 0.85)';
                ctx.lineWidth = 2;
                ctx.strokeRect(left, top, width, height);

                // Percent change label above the box
                const pctChange = ((z.price2 - z.price1) / z.price1 * 100).toFixed(1);
                const label = pctChange + '%';
                const fontSize = Math.round(11 * hr);
                ctx.font = `bold ${fontSize}px 'Inter', 'Helvetica Neue', Arial, sans-serif`;
                ctx.fillStyle = 'rgba(240, 180, 41, 0.9)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(label, left + width / 2, top - 4 * vr);
              }
            });
          },
        }),
      }];
    },
  };
}

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
  const maSeriesRefs          = useRef({});
  const swingZonesPrimitiveRef = useRef(null);

  const [isTradeDialogOpen, setIsTradeDialogOpen] = useState(false);
  const [maVisibility, setMaVisibility] = usePersistedState('chart-ma-visibility',
    () => Object.fromEntries(MA_CONFIG.map(m => [m.key, true]))
  );
  const [swingVisibility, setSwingVisibility] = usePersistedState('chart-swing-visible', true);

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

  // ── Swing boxes: pivot high → first candle that meets or exceeds that pivot high ──
  const SWING_WINDOW = 3; // ±3 bars for local extrema
  const swingZones = useMemo(() => {
    if (!candleData || candleData.length < SWING_WINDOW * 2 + 1) return [];

    // ── STEP 1: Detect pivot highs ──
    const swingHighs = [];

    const startIndex = Math.max(SWING_WINDOW, candleData.length - 365);
    for (let i = startIndex; i < candleData.length - SWING_WINDOW; i++) {
      const current = candleData[i];
      let isSwingHigh = true;

      for (let j = i - SWING_WINDOW; j <= i + SWING_WINDOW; j++) {
        if (j === i) continue;
        if (candleData[j].high >= current.high) isSwingHigh = false;
      }

      if (isSwingHigh) swingHighs.push({ index: i, time: current.time, price: current.high });
    }

    // Sort chronologically
    swingHighs.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

    // ── STEP 2: Build non-overlapping boxes ──
    // A new box only starts once the previous box has closed (its end index is reached).
    const zones = [];
    let nextAllowedIndex = 0; // no new pivot before this index

    for (const pivot of swingHighs) {
      // Skip pivots that fall inside an active (unclosed) box
      if (pivot.index < nextAllowedIndex) continue;

      // Find the first subsequent candle with high >= pivot price
      let endCandle = null;
      let endIndex = -1;
      for (let j = pivot.index + 1; j < candleData.length; j++) {
        if (candleData[j].high >= pivot.price * 0.99) {
          endCandle = candleData[j];
          endIndex = j;
          break;
        }
      }

      // Skip if no candle has yet reached the pivot high (box still open — don't draw)
      if (!endCandle) continue;

      // Box top = pivot high; bottom = lowest low between pivot and end candle
      const top = pivot.price;
      let bottom = pivot.price;
      for (const c of candleData) {
        if (c.time > pivot.time && c.time < endCandle.time && c.low < bottom) {
          bottom = c.low;
        }
      }

      zones.push({
        time1: pivot.time,
        time2: endCandle.time,
        price1: bottom,
        price2: top,
        color: 'rgba(240, 180, 41, 0.55)',
      });

      // Next box can start from the closing candle itself (it may qualify as the next pivot)
      nextAllowedIndex = endIndex;
    }

    // Keep only the last 10 completed boxes
    return zones.slice(-10);
  }, [candleData]);

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

    // ── Swing zones primitive (custom canvas boxes) ──────────
    const swingPrimitive = createSwingZonesPrimitive();
    candleSeries.attachPrimitive(swingPrimitive);
    swingZonesPrimitiveRef.current = swingPrimitive;

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
      volumeSeriesRef.current      = null;
      maSeriesRefs.current         = {};
      swingZonesPrimitiveRef.current = null;
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

  // ── Sync swing zones with primitive ──────────────────────
  useEffect(() => {
    if (!swingZonesPrimitiveRef.current) return;
    swingZonesPrimitiveRef.current.setZones(
      swingVisibility ? swingZones : []
    );
  }, [swingZones, swingVisibility]);

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

        {/* Right side — MA toggles + Swing */}
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
          <span id="ma-controls-divider" />
          <label className="swing-checkbox-label">
            <input
              type="checkbox"
              checked={swingVisibility}
              onChange={() => setSwingVisibility(prev => !prev)}
            />
            <span className="swing-checkbox-text">Recent Volatility</span>
          </label>
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
