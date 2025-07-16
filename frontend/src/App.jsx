import './App.css'
import { useState } from 'react';
import SearchBar from '../component/searchBar'
import StockChart from '../component/StockChart';

function App() {
  const [selectedStock, setSelectedStock] = useState(null);
  const [stockData, setStockData] = useState([]);

  const handleStockSelect = async (stock) => {
    setSelectedStock(stock);
    try {
      // Fetch stock data from your API with max date range and 1d interval
      const response = await fetch(`http://localhost:3001/api/stock/${stock.symbol}?date_range=max&interval=1d`);
      const data = await response.json();
      console.log('Raw API response:', data);
      console.log('Data length from API:', data?.length);
      if (data && data.length > 0) {
        console.log('First date from API:', data[0]?.Date);
        console.log('Last date from API:', data[data.length - 1]?.Date);
      }
      if (Array.isArray(data) && data.length > 0) {
        setStockData(data);
      }
    } catch (error) {
      console.error('Error fetching stock data:', error);
    }
  };
  
  return (
    <div className="app-container">
      <div className="search-bar-wrapper">
        <SearchBar onStockSelect={handleStockSelect} />
      </div>
      {stockData.length > 0 && (
        <div className="chart-container">
          <StockChart stockData={stockData} stockSymbol={selectedStock?.symbol} />
        </div>
      )}
    </div>
  )
}

export default App
