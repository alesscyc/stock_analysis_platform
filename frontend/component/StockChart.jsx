import { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import usePersistedState from '../src/hooks/usePersistedState';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  createSeriesMarkers,
} from 'lightweight-charts';
import './StockChart.css';
import { useTranslation } from '../src/i18n/useTranslation';
import { createTrendLinesPrimitive, loadTrendLines, saveTrendLines } from './trendLines';
import { detectPricePatterns } from './pricePatterns';
import { createPricePatternPrimitive } from './pricePatternChart';

// ── MA config: key → display label and colour ─────────────
const MA_CONFIG = [
  { key: '200MA', label: '200 MA', color: '#e0e0e0' },
  { key: '150MA', label: '150 MA', color: '#f0e040' },
  { key:  '50MA', label:  '50 MA', color: '#4488ff' },
  { key:  '20MA', label:  '20 MA', color: '#00e5c8' },
  { key:  '10MA', label:  '10 MA', color: '#ff5555' },
];

const VOL_MA_CONFIG = [{ key: 'vol20MA', color: '#ffaa00' }];

// ── Horizontal Lines Primitive (custom canvas lines with centered labels) ──
// lightweight-charts v5 uses ISeriesPrimitive for custom overlays.
// Draws horizontal price lines with text labels centered on the chart.
// Supports hover-to-front: hovered label is drawn last (on top) with stronger opacity.
function createHorizontalLinesPrimitive() {
  let lines = [];
  let chart = null;
  let series = null;
  let requestUpdate = null;
  let hoveredIndex = null;

  return {
    setLines(newLines) {
      lines = newLines;
      requestUpdate?.();
    },

    setHoveredIndex(index) {
      if (hoveredIndex === index) return;
      hoveredIndex = index;
      requestUpdate?.();
    },

    getLine(index) {
      return lines[index] || null;
    },

    hitTest(mouseX, mouseY) {
      if (!chart || !series || !lines || lines.length === 0) return -1;
      const mediaWidth = chart.timeScale().width();
      const cx = mediaWidth / 2;
      const fontSize = 11;
      const padX = 6;
      const padY = 3;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const y = series.priceToCoordinate(line.price);
        if (y === null) continue;
        if (line.draggable && Math.abs(mouseY - y) <= 6) {
          return i;
        }
        if (!line.title) continue;
        const textW = line.title.length * 7; // rough width estimate (px)
        const boxW = textW + padX * 2;
        const boxH = fontSize + padY * 2;
        const boxX = cx - boxW / 2;
        const boxY = y - boxH / 2;
        if (mouseX >= boxX && mouseX <= boxX + boxW && mouseY >= boxY && mouseY <= boxY + boxH) {
          return i;
        }
      }
      return -1;
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
        zOrder: () => 'top',
        renderer: () => ({
          draw: (target) => {
            if (!chart || !series || !lines || lines.length === 0) return;

            target.useBitmapCoordinateSpace(scope => {
              const ctx = scope.context;
              const hr = scope.horizontalPixelRatio;
              const vr = scope.verticalPixelRatio;
              const mediaSize = chart.timeScale().width();
              const left = 0;
              const right = mediaSize * hr;

              const drawLine = (line, isHovered) => {
                const y = series.priceToCoordinate(line.price);
                if (y === null) return;
                const yPx = y * vr;

                // Draw horizontal line
                ctx.beginPath();
                ctx.strokeStyle = line.color;
                ctx.lineWidth = (line.lineWidth || 1) * (isHovered ? 1.5 : 1);
                if (line.dotted) {
                  ctx.setLineDash([2 * hr, 4 * hr]);
                } else if (line.dashed) {
                  ctx.setLineDash([6 * hr, 4 * hr]);
                } else {
                  ctx.setLineDash([]);
                }
                ctx.moveTo(left, yPx);
                ctx.lineTo(right, yPx);
                ctx.stroke();
                ctx.setLineDash([]);

                if (line.title) {
                  const fontSize = Math.round(11 * hr);
                  ctx.font = `600 ${fontSize}px 'Inter', 'Helvetica Neue', Arial, sans-serif`;
                  const metrics = ctx.measureText(line.title);
                  const padX = 6 * hr;
                  const padY = 3 * vr;
                  const boxW = metrics.width + padX * 2;
                  const boxH = fontSize + padY * 2;
                  const cx = (left + right) / 2;
                  const boxX = cx - boxW / 2;
                  const boxY = yPx - boxH / 2;

                  ctx.fillStyle = isHovered ? line.color : '#1c2030';
                  ctx.strokeStyle = line.color;
                  ctx.lineWidth = isHovered ? 2 : 1;
                  ctx.beginPath();
                  const r = 4 * hr;
                  ctx.moveTo(boxX + r, boxY);
                  ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
                  ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
                  ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
                  ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
                  ctx.closePath();
                  ctx.fill();
                  ctx.stroke();

                  ctx.fillStyle = isHovered ? '#ffffff' : line.color;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(line.title, cx, yPx + 1 * vr);
                }

              };

              // Draw non-hovered first
              for (let i = 0; i < lines.length; i++) {
                if (i === hoveredIndex) continue;
                drawLine(lines[i], false);
              }
              // Draw hovered last so it appears on top
              if (hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < lines.length) {
                drawLine(lines[hoveredIndex], true);
              }
            });
          },
        }),
      }];
    },
  };
}

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
        zOrder: () => 'top',
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

function backtestActionsToMarkers(actions, validTimes) {
  if (!actions?.length) return [];
  return actions
    .map(a => {
      const time = toChartDate(a.date);
      if (!time || !validTimes.has(time)) return null;
      const isBuy = a.side === 'BUY';
      return {
        time,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#26a69a' : '#ef5350',
        text: isBuy ? 'B' : 'S',
      };
    })
    .filter(Boolean);
}

const WATCHLIST_STORAGE_KEY = 'stockai-watchlist';

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Migrate old string format to object format
    return parsed.map(item => {
      if (typeof item === 'string') {
        return { symbol: item, description: '' };
      }
      return item;
    }).filter(item => item && item.symbol);
  } catch {
    return [];
  }
}

function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(list));
}

function StockChart({ stockData, stockSymbol, currentInterval, onIntervalChange, aiPrediction, onTradeClick, onOrderPriceDrag, orderModification, ibConnected, ordersRefreshToken, backtestTrades }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const onOrderPriceDragRef = useRef(onOrderPriceDrag);
  const dragOrderRef = useRef(null);

  // series refs — held outside React state so we don't trigger re-renders
  const candleSeriesRef  = useRef(null);
  const volumeSeriesRef  = useRef(null);
  const maSeriesRefs          = useRef({});
  const swingZonesPrimitiveRef = useRef(null);
  const pricePatternPrimitiveRef = useRef(null);
  const trendLinesPrimitiveRef  = useRef(null);
  const drawingStartRef         = useRef(null);
  const drawingModeRef          = useRef(false);
  const skipTrendLineSaveRef    = useRef(true);
  const vol20maSeriesRef       = useRef(null);
  const ibLinesPrimitiveRef    = useRef(null);
  const ibPriceLinesRef        = useRef([]);
  const backtestMarkersRef     = useRef(null);

  const [maVisibility, setMaVisibility] = usePersistedState('chart-ma-visibility',
    () => Object.fromEntries(MA_CONFIG.map(m => [m.key, true]))
  );
  const [swingVisibility, setSwingVisibility] = usePersistedState('chart-swing-visible', true);
  const [pricePatternVisibility, setPricePatternVisibility] = usePersistedState('chart-price-pattern-visible', () => {
    try {
      const legacy = localStorage.getItem('chart-double-bottom-visible');
      return legacy === null ? true : JSON.parse(legacy);
    } catch {
      return true;
    }
  });
  const [vol20maVisibility, setVol20maVisibility] = usePersistedState('chart-vol20ma-visibility', true);

  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const indicatorsRef = useRef(null);

  const [watchlistAdded, setWatchlistAdded] = useState(false);
  const [ibPosition, setIbPosition] = useState(null);
  const [symbolOrders, setSymbolOrders] = useState([]);
  const [drawingMode, setDrawingMode] = useState(false);
  const [trendLines, setTrendLines] = useState(() => loadTrendLines(stockSymbol));
  const [selectedTrendLine, setSelectedTrendLine] = useState(-1);
  const { t, language } = useTranslation();

  useEffect(() => {
    drawingModeRef.current = drawingMode;
  }, [drawingMode]);

  useEffect(() => {
    skipTrendLineSaveRef.current = true;
    setTrendLines(loadTrendLines(stockSymbol));
    setSelectedTrendLine(-1);
    setDrawingMode(false);
    drawingModeRef.current = false;
    drawingStartRef.current = null;
    trendLinesPrimitiveRef.current?.setPreview(null);
  }, [stockSymbol]);

  useEffect(() => {
    trendLinesPrimitiveRef.current?.setLines(trendLines, selectedTrendLine);

    if (skipTrendLineSaveRef.current) {
      skipTrendLineSaveRef.current = false;
      return;
    }

    saveTrendLines(stockSymbol, trendLines);
  }, [selectedTrendLine, stockSymbol, trendLines]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && drawingModeRef.current && drawingStartRef.current) {
        drawingStartRef.current = null;
        drawingModeRef.current = false;
        setDrawingMode(false);
        trendLinesPrimitiveRef.current?.setPreview(null);
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return;

      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;
      if (selectedTrendLine < 0) return;

      event.preventDefault();
      setTrendLines(prev => prev.filter((_, index) => index !== selectedTrendLine));
      setSelectedTrendLine(-1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTrendLine]);

  useEffect(() => {
    onOrderPriceDragRef.current = onOrderPriceDrag;
  }, [onOrderPriceDrag]);

  useEffect(() => {
    if (!orderModification?.order) return;
    const nextPrice = Number(orderModification.price);
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) return;

    const orderRef = orderModification.order.id
      ?? orderModification.order.permId
      ?? orderModification.order.orderId;

    setSymbolOrders(prev => prev.map(order => {
      const candidateRef = order.id ?? order.permId ?? order.orderId;
      return candidateRef === orderRef ? { ...order, limitPrice: nextPrice } : order;
    }));
  }, [orderModification]);

  const handleAddToWatchlist = useCallback(() => {
    if (!stockSymbol) return;
    const list = loadWatchlist();
    const upper = stockSymbol.toUpperCase();
    if (!list.some(item => (item.symbol || item) === upper)) {
      list.push({ symbol: upper });
      saveWatchlist(list);
      window.dispatchEvent(new Event('watchlist-updated'));
    }
    setWatchlistAdded(true);
    setTimeout(() => setWatchlistAdded(false), 1500);
  }, [stockSymbol]);

  const intervals = [
    { value: '1d',  label: t('daily')   },
    { value: '1wk', label: t('weekly')  },
    { value: '1mo', label: t('monthly') },
  ];

  // ── Fetch IB portfolio position and orders for current symbol ──
  useEffect(() => {
    if (!ibConnected || !stockSymbol) {
      setIbPosition(null);
      setSymbolOrders([]);
      return;
    }

    let cancelled = false;
    const upperSymbol = stockSymbol.toUpperCase();

    async function fetchIBData() {
      try {
        const [portfolioRes, ordersRes] = await Promise.all([
          fetch('/api/portfolio'),
          fetch('/api/orders/pending'),
        ]);

        if (cancelled) return;

        let position = null;
        if (portfolioRes.ok) {
          const positions = await portfolioRes.json();
          position = positions.find(p => p.symbol === upperSymbol) || null;
        }

        let orders = [];
        if (ordersRes.ok) {
          const allOrders = await ordersRes.json();
          orders = allOrders.filter(o => o.symbol === upperSymbol);
        }

        if (!cancelled) {
          setIbPosition(position);
          setSymbolOrders(orders);
        }
      } catch {
        if (!cancelled) {
          setIbPosition(null);
          setSymbolOrders([]);
        }
      }
    }

    fetchIBData();
    return () => {
      cancelled = true;
    };
  }, [ibConnected, stockSymbol, ordersRefreshToken]);

  // ── Transform raw API data into series arrays ────────────
  const { candleData, volumeData, maData, vol20maData } = useMemo(() => {
    if (!stockData || stockData.length === 0) {
      return { candleData: [], volumeData: [], maData: {}, vol20maData: [] };
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

    // Compute 20-period SMA of volume
    const vol20ma = [];
    const PERIOD = 20;
    for (let i = 0; i < volume.length; i++) {
      if (i < PERIOD - 1) continue;
      let sum = 0;
      for (let j = i - PERIOD + 1; j <= i; j++) sum += volume[j].value;
      vol20ma.push({ time: volume[i].time, value: Math.round(sum / PERIOD) });
    }

    return { candleData: candle, volumeData: volume, maData: ma, vol20maData: vol20ma };
  }, [stockData]);

  const pricePatterns = useMemo(() => {
    if (!candleData.length || currentInterval !== '1d') return [];

    const candles = candleData.map((c, i) => ({
      ...c,
      volume: volumeData[i]?.value ?? 0,
    }));

    return detectPricePatterns(candles);
  }, [candleData, volumeData, currentInterval]);

  const backtestMarkers = useMemo(() => {
    if (!backtestTrades?.length) return [];
    const validTimes = new Set(candleData.map(c => c.time));
    return backtestActionsToMarkers(backtestTrades, validTimes);
  }, [backtestTrades, candleData]);

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
        mode:          PriceScaleMode.Logarithmic,
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

    backtestMarkersRef.current = createSeriesMarkers(candleSeries, []);

    // ── Swing zones primitive (custom canvas boxes) ──────────
    const swingPrimitive = createSwingZonesPrimitive();
    candleSeries.attachPrimitive(swingPrimitive);
    swingZonesPrimitiveRef.current = swingPrimitive;

    const pricePatternPrimitive = createPricePatternPrimitive();
    candleSeries.attachPrimitive(pricePatternPrimitive);
    pricePatternPrimitiveRef.current = pricePatternPrimitive;

    // ── User-drawn trend lines primitive ─────────────────────
    const trendLinesPrimitive = createTrendLinesPrimitive();
    candleSeries.attachPrimitive(trendLinesPrimitive);
    trendLinesPrimitiveRef.current = trendLinesPrimitive;

    const handleChartClick = (param) => {
      if (!drawingModeRef.current || !param.point || param.time == null) return;

      const price = candleSeries.coordinateToPrice(param.point.y);
      if (!Number.isFinite(price)) return;

      const point = {
        time: param.time,
        price: Math.round(price * 100) / 100,
      };

      if (!drawingStartRef.current) {
        drawingStartRef.current = point;
        return;
      }

      const start = drawingStartRef.current;
      setTrendLines(prev => [...prev, { start, end: point }]);
      drawingStartRef.current = null;
      drawingModeRef.current = false;
      setDrawingMode(false);
      trendLinesPrimitiveRef.current?.setPreview(null);
    };
    chart.subscribeClick(handleChartClick);

    // ── Horizontal IB lines primitive (custom canvas lines) ───
    const ibLinesPrimitive = createHorizontalLinesPrimitive();
    candleSeries.attachPrimitive(ibLinesPrimitive);
    ibLinesPrimitiveRef.current = ibLinesPrimitive;

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

    // ── Vol 20 MA line series (on volume price scale) ───────
    const vol20maSeries = chart.addSeries(LineSeries, {
      color:        '#ffaa00',
      lineWidth:    2,
      priceScaleId: 'volume',
      crosshairMarkerVisible: false,
      lastValueVisible:       false,
      priceLineVisible:       false,
    });
    vol20maSeriesRef.current = vol20maSeries;

    // ── Resize observer ─────────────────────────────────────
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.resize(width, height);
      }
    });
    const containerEl = containerRef.current;
    ro.observe(containerEl);

    // ── Mouse drag for pending IB order price lines ──────────
    const getMousePoint = (e) => {
      const rect = containerEl.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const getPriceFromY = (y) => {
      const series = candleSeriesRef.current;
      if (!series || typeof series.coordinateToPrice !== 'function') return null;
      const price = series.coordinateToPrice(y);
      if (!Number.isFinite(price) || price <= 0) return null;
      return Math.round(price * 100) / 100;
    };

    const handleMouseDown = (e) => {
      if (drawingModeRef.current) return;

      const point = getMousePoint(e);
      const trendLineIndex = trendLinesPrimitiveRef.current?.lineIndexAt(point.x, point.y) ?? -1;
      if (trendLineIndex >= 0) {
        setSelectedTrendLine(trendLineIndex);
        e.preventDefault();
        return;
      }
      setSelectedTrendLine(-1);

      if (!ibLinesPrimitiveRef.current) return;
      const hit = ibLinesPrimitiveRef.current.hitTest(point.x, point.y);
      const line = ibLinesPrimitiveRef.current.getLine(hit);
      if (!line?.draggable || !line.order) return;

      e.preventDefault();
      dragOrderRef.current = line.order;
      chart.applyOptions({ handleScroll: false });
      containerEl.classList.add('dragging-order-line');
    };

    const handleMouseUp = () => {
      if (dragOrderRef.current) {
        const finalOrder = dragOrderRef.current;
        chart.applyOptions({ handleScroll: true });
        onOrderPriceDragRef.current?.(finalOrder, finalOrder.limitPrice);
      }
      dragOrderRef.current = null;
      containerEl.classList.remove('dragging-order-line');
    };

    const handleMouseMove = (e) => {
      // Trend line drawing preview: update preview line from start point to cursor
      if (drawingModeRef.current && drawingStartRef.current && trendLinesPrimitiveRef.current) {
        const point = getMousePoint(e);
        const time = chart.timeScale().coordinateToTime(point.x);
        const price = candleSeries.coordinateToPrice(point.y);
        if (time != null && Number.isFinite(price)) {
          trendLinesPrimitiveRef.current.setPreview({
            start: drawingStartRef.current,
            end: { time, price: Math.round(price * 100) / 100 },
          });
        }
        return;
      }

      if (!ibLinesPrimitiveRef.current) return;
      const point = getMousePoint(e);

      if (dragOrderRef.current) {
        const nextPrice = getPriceFromY(point.y);
        if (nextPrice == null) return;
        const orderRef = dragOrderRef.current.id ?? dragOrderRef.current.permId ?? dragOrderRef.current.orderId;
        setSymbolOrders(prev => prev.map(order => {
          const candidateRef = order.id ?? order.permId ?? order.orderId;
          return candidateRef === orderRef ? { ...order, limitPrice: nextPrice } : order;
        }));
        dragOrderRef.current = { ...dragOrderRef.current, limitPrice: nextPrice };
        return;
      }

      const hit = ibLinesPrimitiveRef.current.hitTest(point.x, point.y);
      ibLinesPrimitiveRef.current.setHoveredIndex(hit >= 0 ? hit : null);
      const line = ibLinesPrimitiveRef.current.getLine(hit);
      containerEl.classList.toggle('hovering-order-line', Boolean(line?.draggable));
    };
    containerEl.addEventListener('mousedown', handleMouseDown);
    containerEl.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      containerEl.removeEventListener('mousedown', handleMouseDown);
      containerEl.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      chart.unsubscribeClick(handleChartClick);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current  = null;
      volumeSeriesRef.current      = null;
      maSeriesRefs.current         = {};
      swingZonesPrimitiveRef.current = null;
      trendLinesPrimitiveRef.current = null;
      vol20maSeriesRef.current = null;
      ibLinesPrimitiveRef.current = null;
      ibPriceLinesRef.current = [];
      backtestMarkersRef.current?.detach?.();
      backtestMarkersRef.current = null;
    };
  }, []); // only on mount/unmount

  // ── Backtest BUY/SELL markers ─────────────────────────────
  useEffect(() => {
    backtestMarkersRef.current?.setMarkers(backtestMarkers);
  }, [backtestMarkers]);

  // ── Feed data into series whenever stockData changes ─────
  useEffect(() => {
    if (!candleSeriesRef.current || candleData.length === 0) return;

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current?.setData(volumeData);

    for (const { key } of MA_CONFIG) {
      maSeriesRefs.current[key]?.setData(maData[key] ?? []);
    }

    vol20maSeriesRef.current?.setData(vol20maData ?? []);

    // Set initial visible range
    if (visibleRange) {
      chartRef.current?.timeScale().setVisibleRange(visibleRange);
    }
  }, [candleData, volumeData, maData, vol20maData, visibleRange]);

  // ── Draw / update IB horizontal lines on candlestick series ──
  useEffect(() => {
    if (!ibLinesPrimitiveRef.current || !candleSeriesRef.current) return;

    const lines = [];

    if (ibPosition && typeof ibPosition.avgCost === 'number') {
      lines.push({
        price: ibPosition.avgCost,
        color: '#4488ff',
        lineWidth: 1,
        dashed: false,
        title: t('costQty', { qty: ibPosition.quantity }),
      });
    }

    for (const order of symbolOrders) {
      const price = order.limitPrice != null ? Number(order.limitPrice) : null;
      if (price == null || isNaN(price)) continue;
      const isBuy = order.action === 'BUY';
      const canModify = order.canModify !== false && Number(order.orderId) !== 0;
      lines.push({
        price,
        color: isBuy ? '#00e5c8' : '#ef5350',
        lineWidth: 1,
        dotted: true,
        draggable: canModify,
        order,
        title: `${t(order.action === 'BUY' ? 'buy' : 'sell')} ${order.quantity}`,
      });
    }

    ibLinesPrimitiveRef.current.setLines(lines);

    for (const priceLine of ibPriceLinesRef.current) {
      candleSeriesRef.current.removePriceLine(priceLine);
    }

    ibPriceLinesRef.current = lines.map(line => candleSeriesRef.current.createPriceLine({
      price: line.price,
      color: line.color,
      lineWidth: 1,
      lineStyle: line.dotted ? LineStyle.Dotted : LineStyle.Solid,
      axisLabelVisible: true,
      title: '',
    }));
  }, [ibPosition, symbolOrders, t]);

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

  useEffect(() => {
    if (!pricePatternPrimitiveRef.current) return;
    pricePatternPrimitiveRef.current.setLabelResolver(t);
    pricePatternPrimitiveRef.current.setPatterns(
      pricePatternVisibility ? pricePatterns : []
    );
  }, [pricePatterns, pricePatternVisibility, language, t]);

  // ── Sync Vol 20 MA visibility with series ─────────────────
  useEffect(() => {
    vol20maSeriesRef.current?.applyOptions({ visible: vol20maVisibility });
  }, [vol20maVisibility]);

  // ── MA toggle handler ────────────────────────────────────
  const handleMAToggle = useCallback((key) => {
    setMaVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, [setMaVisibility]);

  // ── Click outside to close indicators dropdown ───────────
  useEffect(() => {
    if (!indicatorsOpen) return;
    const handleClick = (e) => {
      if (indicatorsRef.current && !indicatorsRef.current.contains(e.target)) {
        setIndicatorsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [indicatorsOpen]);

  if (!stockData || stockData.length === 0) {
    return <div>{t('noStockData')}</div>;
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

          <button
            id="trend-line-btn"
            className={drawingMode ? 'active' : ''}
            aria-pressed={drawingMode}
            title={t('trendLine')}
            onClick={() => {
              setDrawingMode(prev => !prev);
              drawingStartRef.current = null;
              setSelectedTrendLine(-1);
              trendLinesPrimitiveRef.current?.setPreview(null);
            }}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="18" x2="20" y2="6" />
              <circle cx="4" cy="18" r="2" />
              <circle cx="20" cy="6" r="2" />
            </svg>
            {t('trendLine')}
          </button>

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
              <span id="ai-recommendation-label">{t('ai')}</span>
              {aiPrediction.status === 'success' ? (
                <>
                  <span
                    id="ai-recommendation-action"
                    className={aiPrediction.recommendation === 'BUY' ? 'buy' : 'sell'}
                  >
                    {aiPrediction.recommendation}
                  </span>
                  <span id="ai-recommendation-confidence">
                    ({aiPrediction.confidence}% {t('confidence')})
                  </span>
                </>
              ) : (
                <span id="ai-recommendation-unavailable">
                  {aiPrediction.status === 'insufficient_data'
                    ? t('insufficientData')
                    : aiPrediction.status === 'prediction_error'
                    ? t('predictionFailed')
                    : t('aiUnavailable')}
                </span>
              )}
            </div>
          )}

          <button
            id="trade-btn"
            onClick={onTradeClick}
            disabled={!ibConnected}
            title={ibConnected ? t('trade') : t('ibNotConnected')}
          >
            {t('trade')}
          </button>

          <button
            id="watchlist-add-btn"
            onClick={handleAddToWatchlist}
            disabled={watchlistAdded}
            title={t('addToWatchlist')}
          >
            {watchlistAdded ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {t('added')}
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
                  <line x1="12" y1="8" x2="12" y2="16"/>
                  <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                {t('watchlist')}
              </>
            )}
          </button>
        </div>

        {/* Right side — Indicators toolbox dropdown */}
        <div id="indicators-dropdown" ref={indicatorsRef}>
          <button
            id="indicators-dropdown-btn"
            onClick={() => setIndicatorsOpen(prev => !prev)}
            aria-expanded={indicatorsOpen}
            aria-haspopup="true"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10M18 20V4M6 20v-4"/>
            </svg>
            {t('indicators')}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: indicatorsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {indicatorsOpen && (
            <div id="indicators-dropdown-panel">
              <div id="indicators-dropdown-header">
                <span id="indicators-dropdown-title">{t('technicalIndicators')}</span>
              </div>

              <div id="indicators-dropdown-section">
                <span id="indicators-dropdown-section-label">{t('movingAverages')}</span>
                {MA_CONFIG.map(({ key, label, color }) => (
                  <label key={key} className="indicator-checkbox-label">
                    <input
                      type="checkbox"
                      checked={maVisibility[key]}
                      onChange={() => handleMAToggle(key)}
                    />
                    <span className="indicator-checkbox-color" style={{ backgroundColor: color }} />
                    <span className="indicator-checkbox-text">{label}</span>
                  </label>
                ))}
              </div>

              <div className="indicators-dropdown-divider" />

              <div id="indicators-dropdown-section">
                <span id="indicators-dropdown-section-label">{t('volume')}</span>
                {VOL_MA_CONFIG.map(({ key, color }) => (
                  <label key={key} className="indicator-checkbox-label">
                    <input
                      type="checkbox"
                      checked={vol20maVisibility}
                      onChange={() => setVol20maVisibility(prev => !prev)}
                    />
                    <span className="indicator-checkbox-color" style={{ backgroundColor: color }} />
                    <span className="indicator-checkbox-text">{t('vol20MA')}</span>
                  </label>
                ))}
              </div>

              <div className="indicators-dropdown-divider" />

              <div id="indicators-dropdown-section">
                <span id="indicators-dropdown-section-label">{t('patterns')}</span>
                <label className="indicator-checkbox-label">
                  <input
                    type="checkbox"
                    checked={swingVisibility}
                    onChange={() => setSwingVisibility(prev => !prev)}
                  />
                  <span className="indicator-checkbox-color" style={{ backgroundColor: '#f0b429' }} />
                  <span className="indicator-checkbox-text">{t('recentVolatility')}</span>
                </label>
                <label className="indicator-checkbox-label">
                  <input
                    type="checkbox"
                    checked={pricePatternVisibility}
                    onChange={() => setPricePatternVisibility(prev => !prev)}
                  />
                  <span className="indicator-checkbox-color" style={{ background: 'linear-gradient(90deg, #26a69a 50%, #ef5350 50%)' }} />
                  <span className="indicator-checkbox-text">{t('pricePattern')}</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Chart canvas ── */}
      <div id="stock-chart-canvas-wrapper">
        <div
          ref={containerRef}
          id="lw-chart-container"
          className={drawingMode ? 'drawing-trend-line' : ''}
        />
      </div>

    </div>
  );
}

export default StockChart;
