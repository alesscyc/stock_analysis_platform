# 🚀 AI-Powered Stock Analysis Platform
<img width="1905" height="947" alt="螢幕擷取畫面 2025-07-19 181121" src="https://github.com/user-attachments/assets/1e6100d7-92b7-48b3-a666-fe076378fc3d" />

A full-stack web application that provides real-time stock data visualization with AI-powered buy/sell recommendations using machine learning.

![Stock Platform Demo](https://img.shields.io/badge/Status-Active-green) ![Python](https://img.shields.io/badge/Python-3.8+-blue) ![React](https://img.shields.io/badge/React-18+-blue) ![Node.js](https://img.shields.io/badge/Node.js-16+-green)

## ✨ Features

### 📊 **Real-Time Stock Data**
- Interactive candlestick charts with volume indicators
- Multiple timeframes (Daily, Weekly, Monthly)
- Zoom and pan functionality for detailed analysis
- Real-time price data from Yahoo Finance API

### 🤖 **AI-Powered Predictions**
- Machine Learning model using Random Forest Classifier
- 16 technical indicators for comprehensive analysis
- Buy/sell recommendations with confidence scores
- Automatic model training for each stock symbol

### 📈 **Technical Analysis**
- **Moving Averages**: 10, 20, 50, 150, 200-day MAs
- **Price Momentum**: 1-day, 1-week, 1-month, 3-month changes
- **Volume Analysis**: 20-day volume moving average trends
- **Price Patterns**: 52-week high/low analysis
- **Volatility Indicators**: Weekly and monthly price ranges
- **Trend Analysis**: Rise vs fall day patterns

## 🏗️ Architecture

```
stock-platform/
├── frontend/           # React.js frontend
│   ├── src/
│   │   ├── App.jsx    # Main application component
│   │   └── component/
│   │       └── StockChart.jsx  # Chart visualization
├── backend/           # Node.js Express server
│   └── server.js     # API endpoints and Python integration
├── analysis/         # Python ML engine
│   └── stock_data.py # Data processing and ML models
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- **Node.js** 16+ and npm
- **Python** 3.8+ with pip
- **Git**

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/stock-platform.git
cd stock-platform
```

### 2. Setup Backend
```bash
cd backend
npm install
```

### 3. Setup Python Environment
```bash
cd ../analysis
pip install -r requirements.txt
```

### 4. Setup Frontend
```bash
cd ../frontend
npm install
```

### 5. Start the Application

**Terminal 1 - Backend Server:**
```bash
cd backend
node server.js
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

The application will be available at `http://localhost:3000`

## 🔧 API Endpoints

### Stock Data
```http
GET /api/stock/:symbol?date_range=max&interval=1d&auto_predict=true
```


## 🤖 Machine Learning Model

### Features Used (16 total):
1. **MA Relationships**: 50MA > 150MA, 150MA > 200MA, Price > 50MA
2. **Volume Trends**: 20-day volume MA uptrend patterns
3. **Long-term Trends**: 200MA trends (1 month, 6 months, 1 year)
4. **Price Positioning**: 30% above 52-week low, within 25% of 52-week high
5. **Volatility**: Weekly and monthly price ranges
6. **Momentum**: 1D, 1W, 1M, 3M percentage changes
7. **Daily Patterns**: More rising days than falling days in past month

### Training Process:
- **Data Selection**: 300 randomly selected historical data points
- **Algorithm**: Random Forest Classifier
- **Split**: 80% training, 20% testing
- **Label**: 1 = BUY (>1% gain in next 22 days), 0 = SELL
- **Retraining**: Fresh model for each prediction

### Prediction Output:
```json
{
  "recommendation": "BUY",
  "confidence": 73.4,
  "buy_probability": 73.4,
  "sell_probability": 26.6,
  "status": "success"
}
```

## 📱 User Interface

### Chart Features:
- **Interactive Candlesticks**: OHLC data visualization
- **Volume Bars**: Color-coded volume indicators
- **Moving Averages**: Toggleable MA lines with custom colors
- **Zoom & Pan**: Mouse wheel zoom and drag functionality
- **Responsive Design**: Works on desktop and mobile

### AI Recommendation Display:
- **🟢 BUY**: Green background with confidence percentage
- **🔴 SELL**: Red background with confidence percentage  
- **⚠️ Warnings**: Yellow background for insufficient data or errors

## 🛠️ Technology Stack

### Frontend:
- **React** 18+ - Modern UI framework
- **Chart.js** - Interactive charting library
- **chartjs-chart-financial** - Candlestick chart support
- **chartjs-plugin-zoom** - Chart zoom and pan functionality

### Backend:
- **Node.js** - Server runtime
- **Express.js** - Web framework
- **Child Process** - Python script execution

### Machine Learning:
- **Python 3.8+** - Core language
- **pandas** - Data manipulation
- **scikit-learn** - Machine learning algorithms
- **yfinance** - Yahoo Finance data API
- **requests** - HTTP client for Polygon.io

### APIs:
- **Yahoo Finance** - Historical stock data

## 🙏 Acknowledgments

- **Yahoo Finance** for providing free historical stock data
- **Polygon.io** for stock search capabilities
- **Chart.js** community for excellent charting tools
- **scikit-learn** for robust ML algorithms
