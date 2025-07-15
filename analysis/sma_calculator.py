import yfinance as yf
import pandas as pd
import sys
import json
from datetime import datetime, timedelta


def get_stock_price_history(symbol, period="max", interval="1d"):
    """
    Get stock price history from Yahoo Finance
    
    Parameters:
    symbol (str): Stock symbol (e.g., 'AAPL', 'GOOGL', 'MSFT')
    period (str): Period to fetch data for. Valid periods: 1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max
    interval (str): Data interval. Valid intervals: 1m,2m,5m,15m,30m,60m,90m,1h,1d,5d,1wk,1mo,3mo
    
    Returns:
    str: JSON string with stock data containing date, open, close, high, low, volume
    """
    try:
        # Create a Ticker object
        ticker = yf.Ticker(symbol)
        
        # Fetch historical data
        hist = ticker.history(period=period, interval=interval)
        
        if hist.empty:
            return None
        
        # Reset index to make Date a column
        hist.reset_index(inplace=True)
        
        # Rename columns for consistency
        hist.columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume', 'Dividends', 'Stock Splits']
        
        # Remove unnecessary columns and reorder
        hist = hist[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]
        
        # Convert to JSON format
        # Convert Date column to string format with time for JSON serialization
        hist['Date'] = hist['Date'].dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Convert DataFrame to JSON
        return json.loads(hist.to_json(orient='records'))
        
        
    except Exception as e:
        return None

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python script.py <function_name> <symbol>"}))
        sys.exit(1)
    
    function_name = sys.argv[1]
    symbol = sys.argv[2]
    
    if function_name == "get_stock_price_history":
        result = get_stock_price_history(symbol)
    else:
        result = {"error": f"Unknown function: {function_name}"}
    
    print(json.dumps(result))