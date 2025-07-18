import React, { useRef } from 'react';
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
  registerables
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { CandlestickController, CandlestickElement, OhlcController, OhlcElement } from 'chartjs-chart-financial';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-date-fns';
import { min } from 'date-fns';

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
  CandlestickController,
  CandlestickElement,
  OhlcController,
  OhlcElement
);

function StockChart({ stockData, stockSymbol, currentInterval, onIntervalChange }) {
  const chartRef = useRef(null);

  if (!stockData || stockData.length === 0) {
    return <div>No stock data available</div>;
  }

  const intervals = [
    { value: '1d', label: 'Daily' },
    { value: '1wk', label: 'Weekly' },
    { value: '1mo', label: 'Monthly' }
  ];

  // Calculate initial visible range based on interval
  let initialVisibleCount;
  
  switch (currentInterval) {
    case '1d':
      // Show 1 year (approximately 252 trading days)
      initialVisibleCount = Math.min(252, stockData.length);
      break;
    case '1wk':
      // Show 5 years (approximately 52 weeks * 5)
      initialVisibleCount = Math.min(260, stockData.length);
      break;
    case '1mo':
      // Show 10 years (approximately 12 months * 10)
      initialVisibleCount = Math.min(120, stockData.length);
      break;
  }
  
  const startIndex = Math.max(0, stockData.length - initialVisibleCount);
  const endIndex = stockData.length - 1;

  const data = {
    labels: stockData.map(item => item.Date),
    datasets: [
      {
        type: 'candlestick',
        label: 'Stock Price',
        data: stockData.map((item, index) => ({
          x: index,
          o: Math.round(parseFloat(item.Open) * 100) / 100,
          h: Math.round(parseFloat(item.High) * 100) / 100,
          l: Math.round(parseFloat(item.Low) * 100) / 100,
          c: Math.round(parseFloat(item.Close) * 100) / 100
        })),
        color: {
          up: '#00ff00',
          down: '#ff0000',
          unchanged: '#999999'
        },
        borderColor: {
          up: '#00aa00',
          down: '#aa0000',
          unchanged: '#666666'
        }
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: true,
        text: stockSymbol || 'Stock Price Chart'
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
          x: {min: 0, max: stockData.length - 1},
          y: {min: 0, max: 'original'}
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
      }
    }
  };

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Controls section */}
      <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        {/* Interval selector buttons */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', marginRight: '10px' }}>Interval:</span>
          {intervals.map(interval => (
            <button
              key={interval.value}
              onClick={() => onIntervalChange(interval.value)}
              style={{
                padding: '5px 15px',
                backgroundColor: currentInterval === interval.value ? '#007bff' : '#f8f9fa',
                color: currentInterval === interval.value ? 'white' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              {interval.label}
            </button>
          ))}
        </div>
      </div>
      
      <div style={{ flex: 1, minHeight: 0 }}>
        <Chart ref={chartRef} type='candlestick' data={data} options={options} />
      </div>
    </div>
  );
}

export default StockChart;