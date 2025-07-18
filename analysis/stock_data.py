import requests
import yfinance as yf
import pandas as pd
import sys
import json
from datetime import datetime, timedelta, date

# Get free API key at polygon.io
API_KEY = 'VssgjSHYbvmp2nmpe8mn6mVLVTo8iUus'  # Replace with your Polygon.io API key

def get_stock_price_history(symbol, date_range='max', interval='1d'): 
    try:
        # Use yfinance to get stock data
        ticker = yf.Ticker(symbol)
        
        # Map date range to yfinance periods or calculate dates
        if date_range == 'max':
            hist = ticker.history(period="max", interval=interval)
        elif date_range in ['1y', '2y', '5y']:
            hist = ticker.history(period=date_range, interval=interval)
        else:
            # Default to 2 years if invalid range provided
            hist = ticker.history(period="2y", interval=interval)
        
        # Check if data is available
        if hist.empty:
            return {"error": f"No data found for symbol: {symbol}"}
        
        # Convert to list of dictionaries
        stock_data = []
        for date_index, row in hist.iterrows():
            # Format date based on interval
            if interval in ['1d', '5d', '1wk', '1mo', '3mo']:
                # Daily and longer intervals: date only (YYYY-MM-DD)
                date_str = str(date_index)[:10]
            else:
                # Intraday intervals: include time (YYYY-MM-DD HH:MM:SS)
                date_str = str(date_index)[:19]
            
            stock_data.append({
                "Date": date_str,
                "Open": float(row['Open']),
                "High": float(row['High']),
                "Low": float(row['Low']),
                "Close": float(row['Close']),
                "Volume": int(row['Volume'])
            })

        # Sort by date ascending (oldest first)
        stock_data.sort(key=lambda x: x['Date'])
        
        return stock_data
        
    except Exception as e:
        return {"error": f"Error fetching data: {str(e)}"}
    
def get_all_symbols():
    """
    Get all available stock symbols from Polygon.io
    """
    try:
        url = f"https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000&apikey={API_KEY}"
        response = requests.get(url)
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'ERROR':
            return {"error": f"API Error: {data.get('error', 'Unknown error')}"}
        
        if data.get('status') != 'OK':
            return {"error": "Failed to fetch symbols from Polygon.io"}
        
        if 'results' not in data:
            return {"error": "No data received from API"}
        
        # Extract symbols
        symbols_data = []
        for ticker in data['results']:
            # Filter for US stocks only
            if ticker.get('market') == 'stocks' and ticker.get('locale') == 'us':
                symbols_data.append({
                    "symbol": ticker.get('ticker', '')
                    #"name": ticker.get('name', 'Unknown'),
                    #"type": ticker.get('type', 'Unknown'),
                    #"active": ticker.get('active', True)
                })
        
        return symbols_data
        
    except Exception as e:
        return {"error": f"Failed to fetch symbols: {str(e)}"}

def search_stocks(query):
    """
    Search for stocks using a keyword - returns matching symbols
    """
    try:
        # Use Polygon.io search endpoint
        url = f"https://api.polygon.io/v3/reference/tickers?search={query}&market=stocks&active=true&limit=50&apikey={API_KEY}"
        response = requests.get(url)
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'ERROR':
            return {"error": f"API Error: {data.get('error', 'Unknown error')}"}
        
        if data.get('status') != 'OK':
            return {"error": "No matches found"}
        
        if 'results' not in data:
            return {"error": "No matches found"}
        
        # Extract matching symbols
        results = []
        for ticker in data['results']:
            # Filter for US stocks only
            if ticker.get('market') == 'stocks' and ticker.get('locale') == 'us':
                results.append({
                    "symbol": ticker.get('ticker', '')
                    #"name": ticker.get('name', 'Unknown'),
                    #"type": ticker.get('type', 'Unknown')
                })
        
        return results
        
    except Exception as e:
        return {"error": f"Search failed: {str(e)}"}



if __name__ == "__main__":
    
    function_name = sys.argv[1]
    
    if function_name == "get_stock_price_history":
        if len(sys.argv) < 3:
            result = {"error": "Symbol required for get_stock_price_history"}
        else:
            symbol = sys.argv[2]
            # Optional parameters: date_range, interval
            date_range = sys.argv[3] if len(sys.argv) > 3 else '2y'
            interval = sys.argv[4] if len(sys.argv) > 4 else '1d'
            result = get_stock_price_history(symbol, date_range, interval)
    
    elif function_name == "get_all_symbols":
        result = get_all_symbols()
    
    elif function_name == "search_stocks":
        if len(sys.argv) < 3:
            result = {"error": "Query required for search_stocks"}
        else:
            query = sys.argv[2]
            result = search_stocks(query)
    
    else:
        result = {"error": f"Unknown function: {function_name}"}
    
    print(json.dumps(result, separators=(',', ':')))