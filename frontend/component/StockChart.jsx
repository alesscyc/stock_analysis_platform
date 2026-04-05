import  { useRef, useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { CandlestickController, CandlestickElement, OhlcController, OhlcElement } from 'chartjs-chart-financial';
import zoomPlugin from 'chartjs-plugin-zoom';
import annotationPlugin from 'chartjs-plugin-annotation';
import 'chartjs-adapter-date-fns';
import TradeDialog from './TradeDialog';
import './StockChart.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  zoomPlugin,
  annotationPlugin,
  CandlestickController,
  CandlestickElement,
  OhlcController,
  OhlcElement
);

// Custom tooltip positioner to align with the high price of the candlestick
Tooltip.positioners.highPrice = function(elements) {
  if (!elements || !elements.length) return false;

  const chart = this.chart;
  // Find the primary stock price element (candlestick)
  const priceElement = elements.find(el =>
    chart.data.datasets[el.datasetIndex].type === 'candlestick' ||
    chart.data.datasets[el.datasetIndex].label === 'Stock Price'
  );

  if (!priceElement) return false;

  const index = priceElement.index;
  const dataset = chart.data.datasets[priceElement.datasetIndex];
  const dataPoint = dataset.data[index];

  // Retrieve High value from candlestick data, or fallback to y for simple charts
  const highValue = (dataPoint && typeof dataPoint.h !== 'undefined') ? dataPoint.h : dataPoint.y;

  // Use the price scale (y) to get the vertical pixel coordinate
  const yPos = chart.scales.y.getPixelForValue(highValue);
  const xPos = priceElement.element.x;

  // Determine horizontal alignment based on the mouse position relative to the chart width
  const chartWidth = chart.width;
  const xAlign = xPos > chartWidth / 2 ? 'right' : 'left';

  return {
    x: xPos,
    y: yPos,
    xAlign: xAlign
  };
};

function StockChart({ stockData, stockSymbol, currentInterval, onIntervalChange }) {
  const chartRef = useRef(null);
  const [isTradeDialogOpen, setIsTradeDialogOpen] = useState(false);

  // Add state for MA visibility
  const [maVisibility, setMaVisibility] = useState({
    '200MA': true,
    '150MA': true,
    '50MA': true,
    '20MA': true,
    '10MA': true
  });


  const aiPrediction = useMemo(() => {
    if (!stockData || stockData.length === 0) return null;
    return stockData.find(item => item.prediction)?.prediction;
  }, [stockData]);

  const latestClose = useMemo(() => {
    if (!stockData || stockData.length === 0) return null;
    const latestPriceItem = [...stockData].reverse().find(item => item.Close != null);
    return latestPriceItem ? Math.round(parseFloat(latestPriceItem.Close) * 100) / 100 : null;
  }, [stockData]);

  const intervals = [
    { value: '1d', label: 'Daily' },
    { value: '1wk', label: 'Weekly' },
    { value: '1mo', label: 'Monthly' }
  ];

  const { startIndex, endIndex } = useMemo(() => {
    if (!stockData || stockData.length === 0) return { startIndex: 0, endIndex: 0 };
    let initialVisibleCount;
    switch (currentInterval) {
      case '1d':
        initialVisibleCount = Math.min(252, stockData.length);
        break;
      case '1wk':
        initialVisibleCount = Math.min(260, stockData.length);
        break;
      case '1mo':
        initialVisibleCount = Math.min(120, stockData.length);
        break;
      default:
        initialVisibleCount = Math.min(252, stockData.length);
    }
    return {
      startIndex: Math.max(0, stockData.length - initialVisibleCount),
      endIndex: stockData.length - 1
    };
  }, [stockData, currentInterval]);
  
  // Handle MA checkbox changes
  const handleMAToggle = (maType) => {
    setMaVisibility(prev => ({
      ...prev,
      [maType]: !prev[maType]
    }));
  };

  const data = useMemo(() => {
    if (!stockData || stockData.length === 0) return { labels: [], datasets: [] };
    const labels = [];
    const candlestickData = [];
    const ma200Data = [];
    const ma150Data = [];
    const ma50Data = [];
    const ma20Data = [];
    const ma10Data = [];
    const volumeData = [];
    const volumeBackground = [];
    const volumeBorder = [];

    for (let i = 0; i < stockData.length; i++) {
      const item = stockData[i];
      const open = parseFloat(item.Open);
      const close = parseFloat(item.Close);
      const high = parseFloat(item.High);
      const low = parseFloat(item.Low);
      const volume = parseInt(item.Volume);

      labels.push(item.Date);
      
      candlestickData.push({
        x: i,
        o: Math.round(open * 100) / 100,
        h: Math.round(high * 100) / 100,
        l: Math.round(low * 100) / 100,
        c: Math.round(close * 100) / 100
      });

      ma200Data.push({ x: i, y: item['200MA'] ? Math.round(parseFloat(item['200MA']) * 100) / 100 : null });
      ma150Data.push({ x: i, y: item['150MA'] ? Math.round(parseFloat(item['150MA']) * 100) / 100 : null });
      ma50Data.push({ x: i, y: item['50MA'] ? Math.round(parseFloat(item['50MA']) * 100) / 100 : null });
      ma20Data.push({ x: i, y: item['20MA'] ? Math.round(parseFloat(item['20MA']) * 100) / 100 : null });
      ma10Data.push({ x: i, y: item['10MA'] ? Math.round(parseFloat(item['10MA']) * 100) / 100 : null });

      volumeData.push({ x: i, y: volume });
      const isUp = close >= open;
      volumeBackground.push(isUp ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)');
      volumeBorder.push(isUp ? 'rgba(0, 255, 0, 0.6)' : 'rgba(255, 0, 0, 0.6)');
    }

    return {
      labels,
      datasets: [
        {
          type: 'candlestick',
          label: 'Stock Price',
          data: candlestickData,
          color: { up: '#00ff00', down: '#ff0000', unchanged: '#999999' },
          borderColor: { up: '#00aa00', down: '#aa0000', unchanged: '#666666' },
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: '200 MA',
          data: ma200Data,
          borderColor: maVisibility['200MA'] ? '#000000' : 'transparent',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          spanGaps: false,
          yAxisID: 'y',
          hidden: !maVisibility['200MA'],
        },
        {
          type: 'line',
          label: '150 MA',
          data: ma150Data,
          borderColor: maVisibility['150MA'] ? '#ffff00' : 'transparent',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          spanGaps: false,
          yAxisID: 'y',
          hidden: !maVisibility['150MA'],
        },
        {
          type: 'line',
          label: '50 MA',
          data: ma50Data,
          borderColor: maVisibility['50MA'] ? '#0000FF' : 'transparent',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          spanGaps: false,
          yAxisID: 'y',
          hidden: !maVisibility['50MA'],
        },
        {
          type: 'line',
          label: '20 MA',
          data: ma20Data,
          borderColor: maVisibility['20MA'] ? '#00ff00' : 'transparent',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          spanGaps: false,
          yAxisID: 'y',
          hidden: !maVisibility['20MA'],
        },
        {
          type: 'line',
          label: '10 MA',
          data: ma10Data,
          borderColor: maVisibility['10MA'] ? '#ff0000' : 'transparent',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          spanGaps: false,
          yAxisID: 'y',
          hidden: !maVisibility['10MA'],
        },
        {
          type: 'bar',
          label: 'Volume',
          data: volumeData,
          backgroundColor: volumeBackground,
          borderColor: volumeBorder,
          borderWidth: 1,
          yAxisID: 'y1'
        }
      ]
    };
  }, [stockData, maVisibility]);

  const options = useMemo(() => {
    if (!stockData || stockData.length === 0) return {};
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        title: {
          display: true,
          text: stockSymbol || 'Stock Price Chart'
        },
        // Customize tooltip to format volume in thousands (k)
        tooltip: {
          mode: 'index',
          intersect: false,
          position: 'highPrice',
          animation: false,
          callbacks: {
            label: function(context) {
              // Get numeric value defensively - parsed.y for bar/candlestick, raw.y or raw for others
              const rawValue = (context.parsed && typeof context.parsed.y !== 'undefined')
                ? context.parsed.y
                : (context.raw && typeof context.raw.y !== 'undefined')
                ? context.raw.y
                : context.raw;
              // If this dataset is the candlestick price dataset, show OHLC lines like the original tooltip
              if (context.dataset && (context.dataset.type === 'candlestick' || context.dataset.label === 'Stock Price')) {
                const raw = context.raw || {};
                const parseNum = (v) => {
                  const n = Number(v);
                  return Number.isFinite(n) ? n : null;
                };

                const o = parseNum(raw.o);
                const h = parseNum(raw.h);
                const l = parseNum(raw.l);
                const c = parseNum(raw.c);

                const fmt = (v) => v === null ? 'N/A' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                const lines = [];
                if (o !== null) lines.push(`Open: ${fmt(o)}`);
                if (h !== null) lines.push(`High: ${fmt(h)}`);
                if (l !== null) lines.push(`Low: ${fmt(l)}`);
                if (c !== null) lines.push(`Close: ${fmt(c)}`);

                // If no OHLC data, fallback to showing dataset label and raw value
                if (lines.length === 0) {
                  if (typeof rawValue === 'number') {
                    return `${context.dataset.label}: ${rawValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  }
                  return `${context.dataset.label}: ${rawValue}`;
                }

                return lines;
              }

              // If this dataset is the volume dataset, show in thousands (K) or millions (M)
              if (context.dataset && context.dataset.label === 'Volume') {
                const value = Number(rawValue) || 0;

                const abs = Math.abs(value);
                // Millions
                if (abs >= 1_000_000) {
                  const millions = value / 1_000_000;
                  const formatted = (Math.abs(millions) >= 100 || Number.isInteger(millions))
                    ? `${Math.round(millions).toLocaleString()}M`
                    : `${millions.toFixed(1)}M`;
                  return `${context.dataset.label}: ${formatted}`;
                }

                // Thousands
                if (abs >= 1_000) {
                  const thousands = value / 1000;
                  const formatted = (Math.abs(thousands) >= 100 || Number.isInteger(thousands))
                    ? `${Math.round(thousands).toLocaleString()}K`
                    : `${thousands.toFixed(1)}K`;
                  return `${context.dataset.label}: ${formatted}`;
                }

                // Less than 1000 - show raw with thousand separators
                return `${context.dataset.label}: ${value.toLocaleString()}`;
              }

              // Fallback for other datasets - show a nicely formatted number
              if (typeof rawValue === 'number') {
                // For prices, show two decimals
                return `${context.dataset.label}: ${rawValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              }
              return `${context.dataset.label}: ${rawValue}`;
            }
          }
        },
        annotation: {
          annotations: latestClose != null ? {
            horizontalLine: {
              type: 'line',
              yMin: latestClose,
              yMax: latestClose,
              yScaleID: 'y',
              borderColor: 'rgba(255, 165, 0, 0.9)',
              borderWidth: 2
            }
          } : {}
        },
        zoom: {
          zoom: {
            wheel: {
              enabled: true,
              speed: 0.1
            },
            pinch: {
              enabled: true
            },
            mode: 'x',
          },
          pan: {
            enabled: true,
            mode: 'x',
            threshold: 5
          },
          limits: {
            x: { min: 0, max: stockData.length - 1 },
            y: { min: 0, max: 'original' }
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          min: startIndex,
          max: endIndex
        },
        y: {
          beginAtZero: false,
          grace: '5%',
          min: 0
        },
        y1: {
          type: 'linear',
          display: false,
          position: 'right',
          beginAtZero: false,
          max: function (context) {
            const chart = context.chart;
            const xAxis = chart.scales.x;

            // Calculate initial volume range based on current startIndex/endIndex
            const currentInitialData = stockData.slice(startIndex, endIndex + 1);
            const currentInitialMaxVolume = Math.max(...currentInitialData.map(item => parseInt(item.Volume) || 0));

            // Use current initial max if chart not ready or during initial load
            if (!xAxis || typeof xAxis.min !== 'number' || typeof xAxis.max !== 'number') {
              return currentInitialMaxVolume * 4;
            }

            // Chart is ready and user is panning/zooming
            const visibleMin = Math.max(0, Math.floor(xAxis.min));
            const visibleMax = Math.min(stockData.length - 1, Math.ceil(xAxis.max));
            
            // Ensure we have valid range
            if (visibleMin >= visibleMax) {
              return currentInitialMaxVolume * 4;
            }

            const visibleVolumeData = stockData.slice(visibleMin, visibleMax + 1);
            
            // Handle empty data
            if (visibleVolumeData.length === 0) {
              return currentInitialMaxVolume * 4;
            }

            const maxVolume = Math.max(...visibleVolumeData.map(item => parseInt(item.Volume) || 0));
            
            return maxVolume * 4;
          },
          min: 0
        }
      }
    };
  }, [stockSymbol, stockData, startIndex, endIndex, latestClose]);

  if (!stockData || stockData.length === 0) {
    return <div>No stock data available</div>;
  }


  return (
    <div id="stock-chart-root">
      {/* Controls section */}
      <div id="stock-chart-controls">
        {/* Left side - Interval selector and AI Recommendation */}
        <div id="stock-chart-controls-left">
          {/* Interval selector buttons */}
          <div id="interval-selector">
            <span id="interval-selector-label">Interval:</span>
            {intervals.map(interval => (
              <button
                key={interval.value}
                onClick={() => onIntervalChange(interval.value)}
                className={`interval-btn${currentInterval === interval.value ? ' active' : ''}`}
              >
                {interval.label}
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
                    : 'AI unavailable'
                  }
                </span>
              )}
            </div>
          )}

          <button
            id="trade-btn"
            onClick={() => setIsTradeDialogOpen(true)}
          >
            Trade
          </button>
        </div>

        {/* MA checkboxes - Right side */}
        <div id="ma-controls">
          <span id="ma-controls-label">Moving Averages:</span>
          {[
            { key: '200MA', label: '200 MA' },
            { key: '150MA', label: '150 MA' },
            { key: '50MA', label: '50 MA' },
            { key: '20MA', label: '20 MA' },
            { key: '10MA', label: '10 MA' }
          ].map(ma => (
            <label key={ma.key} className="ma-checkbox-label">
              <input
                type="checkbox"
                checked={maVisibility[ma.key]}
                onChange={() => handleMAToggle(ma.key)}
              />
              <span className="ma-checkbox-text">
                {ma.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div id="stock-chart-canvas-wrapper">
        <Chart ref={chartRef} type='candlestick' data={data} options={options} />
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
