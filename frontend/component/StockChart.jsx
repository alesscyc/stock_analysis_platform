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
  TimeScale
} from 'chart.js';
import { Line } from 'react-chartjs-2';
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
  zoomPlugin
);

function StockChart({ stockData, stockSymbol }) {
  const chartRef = useRef(null);
  
  console.log('StockChart received data:', stockData);
  console.log('Data length:', stockData?.length);
  console.log('First item:', stockData?.[0]);
  console.log('Last item:', stockData?.[stockData.length - 1]);
  
  // Check date range
  if (stockData && stockData.length > 0) {
    const dates = stockData.map(item => new Date(item.Date));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    console.log('Date range:', minDate.toISOString().split('T')[0], 'to', maxDate.toISOString().split('T')[0]);
    console.log('Years covered:', (maxDate.getFullYear() - minDate.getFullYear()));
  }

  if (!stockData || stockData.length === 0) {
    return <div>No stock data available</div>;
  }

  // Sort data by date to ensure chronological order
  const sortedData = [...stockData].sort((a, b) => new Date(a.Date) - new Date(b.Date));

  // Get the actual data range for setting axis limits
  const firstDate = new Date(sortedData[0].Date);
  const lastDate = new Date(sortedData[sortedData.length - 1].Date);

  const data = {
    labels: sortedData.map(item => item.Date),
    datasets: [
      {
        label: 'Close Price',
        data: sortedData.map(item => item.Close),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.1,
        borderWidth: 1,
        pointRadius: 0,
        pointHoverRadius: 4
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: stockSymbol || 'Stock Price Chart'
      },
      zoom: {
        zoom: {
          wheel: {
            enabled: true,
          },
          pinch: {
            enabled: true
          },
          mode: 'x',
        },
        pan: {
          enabled: true,
          mode: 'x',
        },
        limits: {
          x: {
            min: firstDate,
            max: lastDate,
            minRange: 24 * 60 * 60 * 1000 * 30 // minimum 30 days visible
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          parser: 'yyyy-MM-dd',
          tooltipFormat: 'MMM dd, yyyy',
          displayFormats: {
            day: 'MMM dd',
            month: 'MMM yyyy',
            year: 'yyyy'
          }
        },
        min: firstDate,
        max: lastDate,
        display: true,
        ticks: {
          maxTicksLimit: 20,
          autoSkip: true
        }
      },
      y: {
        beginAtZero: false,
        display: true
      }
    },
    elements: {
      point: {
        radius: 0,
        hoverRadius: 4
      }
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '400px' }}>
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}

export default StockChart;