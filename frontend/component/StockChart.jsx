import React, { useRef, useState } from 'react';
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

  // Add state for MA visibility
  const [maVisibility, setMaVisibility] = useState({
    '200MA': true,
    '150MA': true,
    '50MA': true,
    '20MA': true,
    '10MA': true
  });

  if (!stockData || stockData.length === 0) {
    return <div>No stock data available</div>;
  }

  // Extract AI prediction from stockData
  const aiPrediction = stockData.find(item => item.prediction)?.prediction;

  const intervals = [
    { value: '1d', label: 'Daily' },
    { value: '1wk', label: 'Weekly' },
    { value: '1mo', label: 'Monthly' }
  ];

  // Calculate initial visible range based on interval
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
  }

  const startIndex = Math.max(0, stockData.length - initialVisibleCount);
  const endIndex = stockData.length - 1;

  // Handle MA checkbox changes
  const handleMAToggle = (maType) => {
    setMaVisibility(prev => ({
      ...prev,
      [maType]: !prev[maType]
    }));
  };

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
        },
        yAxisID: 'y',
      },
      {
        type: 'line',
        label: '200 MA',
        data: stockData.map((item, index) => ({
          x: index,
          y: item['200MA'] ? Math.round(parseFloat(item['200MA']) * 100) / 100 : null
        })),
        borderColor: maVisibility['200MA'] ? '#000000' : 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        spanGaps: false,
        yAxisID: 'y',
        hidden: !maVisibility['200MA'], // Hide the dataset and its label
      },
      {
        type: 'line',
        label: '150 MA',
        data: stockData.map((item, index) => ({
          x: index,
          y: item['150MA'] ? Math.round(parseFloat(item['150MA']) * 100) / 100 : null
        })),
        borderColor: maVisibility['150MA'] ? '#ffff00' : 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        spanGaps: false,
        yAxisID: 'y',
        hidden: !maVisibility['150MA'] // Hide the dataset and its label
      },
      {
        type: 'line',
        label: '50 MA',
        data: stockData.map((item, index) => ({
          x: index,
          y: item['50MA'] ? Math.round(parseFloat(item['50MA']) * 100) / 100 : null
        })),
        borderColor: maVisibility['50MA'] ? '#0000FF' : 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        spanGaps: false,
        yAxisID: 'y',
        hidden: !maVisibility['50MA'] // Hide the dataset and its label
      },
      {
        type: 'line',
        label: '20 MA',
        data: stockData.map((item, index) => ({
          x: index,
          y: item['20MA'] ? Math.round(parseFloat(item['20MA']) * 100) / 100 : null
        })),
        borderColor: maVisibility['20MA'] ? '#00ff00' : 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        spanGaps: false,
        yAxisID: 'y',
        hidden: !maVisibility['20MA'] // Hide the dataset and its label
      },
      {
        type: 'line',
        label: '10 MA',
        data: stockData.map((item, index) => ({
          x: index,
          y: item['10MA'] ? Math.round(parseFloat(item['10MA']) * 100) / 100 : null
        })),
        borderColor: maVisibility['10MA'] ? '#ff0000' : 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        spanGaps: false,
        yAxisID: 'y',
        hidden: !maVisibility['10MA'] // Hide the dataset and its label
      },
      {
        type: 'bar',
        label: 'Volume',
        data: stockData.map((item, index) => ({
          x: index,
          y: parseInt(item.Volume)
        })),
        backgroundColor: stockData.map((item) => {
          const open = parseFloat(item.Open);
          const close = parseFloat(item.Close);
          return close >= open ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)';
        }),
        borderColor: stockData.map((item) => {
          const open = parseFloat(item.Open);
          const close = parseFloat(item.Close);
          return close >= open ? 'rgba(0, 255, 0, 0.6)' : 'rgba(255, 0, 0, 0.6)';
        }),
        borderWidth: 1,
        yAxisID: 'y1'
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

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Controls section */}
      <div style={{
        marginBottom: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 0,
        gap: '20px'
      }}>
        {/* Left side - Interval selector and AI Recommendation */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
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

          {/* AI Recommendation */}
          {aiPrediction && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 16px',
              borderRadius: '8px',
              backgroundColor: aiPrediction.status === 'success' 
                ? (aiPrediction.recommendation === 'BUY' ? '#c3e6cb' : '#f8d7da')
                : '#fff3cd',
              border: aiPrediction.status === 'success'
                ? `2px solid ${aiPrediction.recommendation === 'BUY' ? '#28a745' : '#dc3545'}`
                : '2px solid #ffc107',
              fontSize: '14px',
              fontWeight: 'bold'
            }}>
              <span style={{ color: '#333' }}>AI:</span>
              {aiPrediction.status === 'success' ? (
                <>
                  <span style={{
                    color: aiPrediction.recommendation === 'BUY' ? '#155724' : '#721c24',
                    fontSize: '16px'
                  }}>
                    {aiPrediction.recommendation}
                  </span>
                  <span style={{
                    color: '#666',
                    fontSize: '12px',
                    fontWeight: 'normal'
                  }}>
                    ({aiPrediction.confidence}% confidence)
                  </span>
                </>
              ) : (
                <span style={{
                  color: '#856404',
                  fontSize: '14px',
                  fontWeight: 'normal'
                }}>
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
        </div>

        {/* MA checkboxes - Right side */}
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold' }}>Moving Averages:</span>
          {[
            { key: '200MA', label: '200 MA' },
            { key: '150MA', label: '150 MA' },
            { key: '50MA', label: '50 MA' },
            { key: '20MA', label: '20 MA' },
            { key: '10MA', label: '10 MA' }
          ].map(ma => (
            <label key={ma.key} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
              fontSize: '14px'
            }}>
              <input
                type="checkbox"
                checked={maVisibility[ma.key]}
                onChange={() => handleMAToggle(ma.key)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{
                fontWeight: 'bold'
              }}>
                {ma.label}
              </span>
            </label>
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