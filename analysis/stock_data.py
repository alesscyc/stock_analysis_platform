import requests
import yfinance as yf
import pandas as pd
import sys
import json
from datetime import datetime, timedelta, date

# Get free API key at polygon.io
API_KEY = 'VssgjSHYbvmp2nmpe8mn6mVLVTo8iUus'  # Replace with your Polygon.io API key

def get_stock_price_history(symbol):
    
    try:
        # Calculate date range (2 years back for free tier)
        end_date = date.today()
        start_date = end_date - timedelta(days=730)  # 2 years back
        
        # Format dates for Polygon API
        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')
        
        # Polygon.io aggregates endpoint for daily data
        url = f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/1/day/{start_str}/{end_str}?adjusted=true&sort=desc&limit=50000&apikey={API_KEY}"
        
        response = requests.get(url)
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'ERROR':
            return {"error": f"API Error: {data.get('error', 'Unknown error')}"}
        
        if data.get('status') != 'OK':
            return {"error": f"No data found for symbol: {symbol}"}
        
        if 'results' not in data or not data['results']:
            return {"error": f"No data found for symbol: {symbol}"}
        
        # Convert to list of dictionaries
        stock_data = []
        for item in data['results']:
            # Convert timestamp to date string
            date_str = datetime.fromtimestamp(item['t'] / 1000).strftime('%Y-%m-%d %H:%M:%S')
            
            stock_data.append({
                "Date": date_str,
                "Open": float(item['o']),
                "High": float(item['h']),
                "Low": float(item['l']),
                "Close": float(item['c']),
                "Volume": int(item['v'])
            })
        
        return stock_data
        
    except requests.exceptions.RequestException as e:
        return {"error": f"Network error: {str(e)}"}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}
    
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
            result = get_stock_price_history(symbol)
    
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