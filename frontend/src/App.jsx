import './App.css'
import { useState } from 'react';
import SearchBar from '../component/searchBar'
import StockChart from '../component/StockChart';

function App() {
  const [selectedStock, setSelectedStock] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [currentInterval, setCurrentInterval] = useState('1d');

  const fetchStockData = async (stock, interval = '1d', autoPredictEnabled = true) => {
    try {
      // Fetch stock data from your API with max date range and specified interval
      const autoPredictParam = autoPredictEnabled ? 'true' : 'false';
      const response = await fetch(`http://localhost:3001/api/stock/${stock.symbol}?date_range=max&interval=${interval}&auto_predict=${autoPredictParam}`);
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0) {
        setStockData(data);
        setCurrentInterval(interval);
      }
    } catch (error) {
      console.error('Error fetching stock data:', error);
    }
  };

  const handleStockSelect = async (stock) => {
    setSelectedStock(stock);
    await fetchStockData(stock, currentInterval);
  };

  const handleIntervalChange = async (interval) => {
    if (selectedStock) {
      await fetchStockData(selectedStock, interval, false); // auto_predict = false for interval changes
    }
  };
  
  return (
    <div className="app-container">
      <div className="search-bar-wrapper">
        <SearchBar onStockSelect={handleStockSelect} />
      </div>
      {stockData.length > 0 && (
        <div className="chart-container">
          <StockChart 
            stockData={stockData} 
            stockSymbol={selectedStock?.symbol}
            currentInterval={currentInterval}
            onIntervalChange={handleIntervalChange}
          />
        </div>
      )}
    </div>
  )
}

export default App
