import yfinance as yf
import pandas as pd
import numpy as np
import sys
import json
import os
import pickle
import math
from datetime import datetime, timedelta

# ── Model cache ──────────────────────────────────────────────────────────────
MODEL_CACHE_TTL_HOURS = 4
_model_cache = {}  # symbol -> {'model_data': ..., 'trained_at': datetime}

# Optional disk persistence directory (created on first use)
MODEL_CACHE_DIR = os.path.join(os.path.dirname(__file__), 'model_cache')


def _get_cache_path(symbol):
    safe = ''.join(c for c in symbol.upper() if c.isalnum())
    return os.path.join(MODEL_CACHE_DIR, f'{safe}.pkl')


def _load_model_from_disk(symbol):
    path = _get_cache_path(symbol)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'rb') as f:
            return pickle.load(f)
    except Exception:
        return None


def _save_model_to_disk(symbol, cache_entry):
    os.makedirs(MODEL_CACHE_DIR, exist_ok=True)
    path = _get_cache_path(symbol)
    try:
        with open(path, 'wb') as f:
            pickle.dump(cache_entry, f)
    except Exception:
        pass


def _get_cached_model(symbol):
    """Return cached model_data if present and not stale, else None."""
    symbol = symbol.upper()
    now = datetime.now()

    # Check in-memory cache first
    entry = _model_cache.get(symbol)
    if entry:
        age = now - entry['trained_at']
        if age < timedelta(hours=MODEL_CACHE_TTL_HOURS):
            return entry['model_data']
        # Stale — evict
        del _model_cache[symbol]

    # Try disk cache
    entry = _load_model_from_disk(symbol)
    if entry:
        age = now - entry['trained_at']
        if age < timedelta(hours=MODEL_CACHE_TTL_HOURS):
            _model_cache[symbol] = entry
            return entry['model_data']

    return None


def _set_cached_model(symbol, model_data):
    """Store model_data in memory and optionally on disk."""
    symbol = symbol.upper()
    entry = {'model_data': model_data, 'trained_at': datetime.now()}
    _model_cache[symbol] = entry
    _save_model_to_disk(symbol, entry)


def get_stock_price_history(symbol, date_range='max', interval='1d', auto_predict=False): 
    try:
        # Use yfinance to get stock data
        ticker = yf.Ticker(symbol)
        
        # Fetch market cap from ticker info (static per symbol)
        try:
            info = ticker.info
            market_cap = info.get('marketCap') if info else None
        except Exception:
            market_cap = None
        
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
        
        hist['200MA'] = hist['Close'].rolling(window=200, min_periods=200).mean()
        hist['150MA'] = hist['Close'].rolling(window=150, min_periods=150).mean()
        hist['50MA'] = hist['Close'].rolling(window=50, min_periods=50).mean()
        hist['20MA'] = hist['Close'].rolling(window=20, min_periods=20).mean()
        hist['10MA'] = hist['Close'].rolling(window=10, min_periods=10).mean()
        
        # Volume moving averages
        hist['Volume_10MA'] = hist['Volume'].rolling(window=10, min_periods=10).mean()
        hist['Volume_20MA'] = hist['Volume'].rolling(window=20, min_periods=20).mean()
        hist['Volume_30MA'] = hist['Volume'].rolling(window=30, min_periods=30).mean()
        hist['Volume_60MA'] = hist['Volume'].rolling(window=60, min_periods=60).mean()
        hist['Volume_90MA'] = hist['Volume'].rolling(window=90, min_periods=90).mean()
        
        # Dollar volume (Close * Volume)
        hist['Dollar_Volume'] = hist['Close'] * hist['Volume']

        # ── ML feature computation (only when auto_predict is requested) ──
        # The chart does NOT display these 16 features — they are only used for
        # RandomForest training and prediction. Skipping them when auto_predict=false
        # saves ~100 lines of rolling-window pandas operations per symbol load.
        if auto_predict and interval == '1d':
            
            # Technical indicator features (binary: 1 = True, 0 = False)
            hist['MA50_above_MA150'] = (hist['50MA'] > hist['150MA']).astype(int)
            hist['MA150_above_MA200'] = (hist['150MA'] > hist['200MA']).astype(int)
            hist['Price_above_MA50'] = (hist['Close'] > hist['50MA']).astype(int)
            
            # Volume trend feature: check if 20-day volume MA is in uptrend
            hist['Volume_20MA_daily_change'] = hist['Volume_20MA'].diff()
            hist['Volume_20MA_up_day'] = (hist['Volume_20MA_daily_change'] > 0).astype(int)
            # Check if 70% of past 10 days had volume 20MA going up (shorter window for volume)
            hist['Volume_20MA_uptrend_count'] = hist['Volume_20MA_up_day'].rolling(window=10, min_periods=10).sum()
            hist['Volume_20MA_uptrend'] = (hist['Volume_20MA_uptrend_count'] >= 7).astype(int)  # 7/10 = 70%
            
            # 200MA uptrend feature: check if 200MA is in uptrend for past month
            # Calculate daily change in 200MA
            hist['MA200_daily_change'] = hist['200MA'].diff()
            hist['MA200_up_day'] = (hist['MA200_daily_change'] > 0).astype(int)
            
            # Rolling window to check if 90% of past period had 200MA going up
            # Past month (22 trading days)
            hist['MA200_uptrend_count'] = hist['MA200_up_day'].rolling(window=22, min_periods=22).sum()
            hist['MA200_uptrend_past_month'] = (hist['MA200_uptrend_count'] >= 20).astype(int)  # 20/22 = ~90%
            
            # 200MA vs 1 month ago: current 200MA > 200MA 22 trading days ago
            hist['MA200_month_ago'] = hist['200MA'].shift(22)
            hist['MA200_above_month_ago'] = (hist['200MA'] > hist['MA200_month_ago']).astype(int)
            
            # Past 6 months (~132 trading days)
            hist['MA200_uptrend_count_6m'] = hist['MA200_up_day'].rolling(window=132, min_periods=132).sum()
            hist['MA200_uptrend_past_6months'] = (hist['MA200_uptrend_count_6m'] >= 119).astype(int)  # 119/132 = ~90%
            
            # Past 1 year (~252 trading days)
            hist['MA200_uptrend_count_1y'] = hist['MA200_up_day'].rolling(window=252, min_periods=252).sum()
            hist['MA200_uptrend_past_year'] = (hist['MA200_uptrend_count_1y'] >= 227).astype(int)  # 227/252 = ~90%
            
            # 52-week low feature: check if current price is at least 30% above 52-week low
            hist['52week_low'] = hist['Close'].rolling(window=252, min_periods=252).min()
            hist['Price_above_52week_low_30pct'] = ((hist['Close'] - hist['52week_low']) / hist['52week_low'] >= 0.30).astype(int)
            
            # 52-week high feature: check if current price is within 25% of 52-week high
            hist['52week_high'] = hist['Close'].rolling(window=252, min_periods=252).max()
            hist['Price_within_25pct_of_52week_high'] = ((hist['52week_high'] - hist['Close']) / hist['52week_high'] <= 0.25).astype(int)
            
            # Price range features: volatility indicators
            # Past week (5 trading days)
            hist['Week_High'] = hist['High'].rolling(window=5, min_periods=5).max()
            hist['Week_Low'] = hist['Low'].rolling(window=5, min_periods=5).min()
            hist['Week_Price_Range'] = hist['Week_High'] - hist['Week_Low']
            
            # Past month (22 trading days)
            hist['Month_High'] = hist['High'].rolling(window=22, min_periods=22).max()
            hist['Month_Low'] = hist['Low'].rolling(window=22, min_periods=22).min()
            hist['Month_Price_Range'] = hist['Month_High'] - hist['Month_Low']
            
            # Price change features: momentum indicators
            # 1-day price change (percentage)
            hist['Price_Change_1D'] = (hist['Close'] - hist['Close'].shift(1)) / hist['Close'].shift(1) * 100
            
            # 1-week price change (percentage)
            hist['Price_Change_1W'] = (hist['Close'] - hist['Close'].shift(5)) / hist['Close'].shift(5) * 100
            
            # 1-month price change (percentage)
            hist['Price_Change_1M'] = (hist['Close'] - hist['Close'].shift(22)) / hist['Close'].shift(22) * 100
            
            # 3-month price change (percentage)
            hist['Price_Change_3M'] = (hist['Close'] - hist['Close'].shift(66)) / hist['Close'].shift(66) * 100
            
            # Price rise/fall day feature: check if more rising days than falling days in past month
            hist['Price_daily_change'] = hist['Close'].diff()
            hist['Price_up_day'] = (hist['Price_daily_change'] > 0).astype(int)
            hist['Price_down_day'] = (hist['Price_daily_change'] < 0).astype(int)
            
            # Count rise and fall days in past month (22 trading days)
            hist['Price_rise_days_month'] = hist['Price_up_day'].rolling(window=22, min_periods=22).sum()
            hist['Price_fall_days_month'] = hist['Price_down_day'].rolling(window=22, min_periods=22).sum()
            hist['Price_more_rise_than_fall_month'] = (hist['Price_rise_days_month'] > hist['Price_fall_days_month']).astype(int)
            
            # Shift close price back to get future price
            hist['Future_Close'] = hist['Close'].shift(-22)
            
            # Calculate percentage change after 1 month
            hist['Future_Return'] = (hist['Future_Close'] - hist['Close']) / hist['Close']
            
            # Create buy/sell label: 1 = buy (price up by more than 5%), 0 = sell (price up by 5% or less)
            hist['Label'] = (hist['Future_Return'] > 0.05).astype(int)


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
            
            data_point = {
                "Date": date_str,
                "Open": float(row['Open']),
                "High": float(row['High']),
                "Low": float(row['Low']),
                "Close": float(row['Close']),
                "Volume": int(row['Volume']),
                "Volume_10MA": round(float(row['Volume_10MA']), 0) if pd.notna(row['Volume_10MA']) else None,
                "Volume_20MA": round(float(row['Volume_20MA']), 0) if pd.notna(row['Volume_20MA']) else None,
                "Volume_30MA": round(float(row['Volume_30MA']), 0) if pd.notna(row['Volume_30MA']) else None,
                "Volume_60MA": round(float(row['Volume_60MA']), 0) if pd.notna(row['Volume_60MA']) else None,
                "Volume_90MA": round(float(row['Volume_90MA']), 0) if pd.notna(row['Volume_90MA']) else None,
                "Dollar_Volume": round(float(row['Dollar_Volume']), 2) if pd.notna(row['Dollar_Volume']) else None,
                "200MA": round(float(row['200MA']), 2) if pd.notna(row['200MA']) else None,
                "150MA": round(float(row['150MA']), 2) if pd.notna(row['150MA']) else None,
                "50MA": round(float(row['50MA']), 2) if pd.notna(row['50MA']) else None,
                "20MA": round(float(row['20MA']), 2) if pd.notna(row['20MA']) else None,
                "10MA": round(float(row['10MA']), 2) if pd.notna(row['10MA']) else None,
                "MarketCap": market_cap
            }
            if auto_predict and interval == '1d':
                data_point["MA50_above_MA150"] = int(row['MA50_above_MA150']) if pd.notna(row['MA50_above_MA150']) else None
                data_point["MA150_above_MA200"] = int(row['MA150_above_MA200']) if pd.notna(row['MA150_above_MA200']) else None
                data_point["Price_above_MA50"] = int(row['Price_above_MA50']) if pd.notna(row['Price_above_MA50']) else None
                data_point["Volume_20MA_uptrend"] = int(row['Volume_20MA_uptrend']) if pd.notna(row['Volume_20MA_uptrend']) else None
                data_point["MA200_uptrend_past_month"] = int(row['MA200_uptrend_past_month']) if pd.notna(row['MA200_uptrend_past_month']) else None
                data_point["MA200_above_month_ago"] = int(row['MA200_above_month_ago']) if pd.notna(row['MA200_above_month_ago']) else None
                data_point["MA200_uptrend_past_6months"] = int(row['MA200_uptrend_past_6months']) if pd.notna(row['MA200_uptrend_past_6months']) else None
                data_point["MA200_uptrend_past_year"] = int(row['MA200_uptrend_past_year']) if pd.notna(row['MA200_uptrend_past_year']) else None
                data_point["52week_low"] = round(float(row['52week_low']), 2) if pd.notna(row['52week_low']) else None
                data_point["52week_high"] = round(float(row['52week_high']), 2) if pd.notna(row['52week_high']) else None
                data_point["Price_above_52week_low_30pct"] = int(row['Price_above_52week_low_30pct']) if pd.notna(row['Price_above_52week_low_30pct']) else None
                data_point["Price_within_25pct_of_52week_high"] = int(row['Price_within_25pct_of_52week_high']) if pd.notna(row['Price_within_25pct_of_52week_high']) else None
                data_point["Week_Price_Range"] = round(float(row['Week_Price_Range']), 2) if pd.notna(row['Week_Price_Range']) else None
                data_point["Month_Price_Range"] = round(float(row['Month_Price_Range']), 2) if pd.notna(row['Month_Price_Range']) else None
                data_point["Price_Change_1D"] = round(float(row['Price_Change_1D']), 2) if pd.notna(row['Price_Change_1D']) else None
                data_point["Price_Change_1W"] = round(float(row['Price_Change_1W']), 2) if pd.notna(row['Price_Change_1W']) else None
                data_point["Price_Change_1M"] = round(float(row['Price_Change_1M']), 2) if pd.notna(row['Price_Change_1M']) else None
                data_point["Price_Change_3M"] = round(float(row['Price_Change_3M']), 2) if pd.notna(row['Price_Change_3M']) else None
                data_point["Price_more_rise_than_fall_month"] = int(row['Price_more_rise_than_fall_month']) if pd.notna(row['Price_more_rise_than_fall_month']) else None
                data_point["Label"] = int(row['Label']) if pd.notna(row['Label']) else None
            
            stock_data.append(data_point)


        # Sort by date ascending (oldest first)
        stock_data.sort(key=lambda x: x['Date'])
        
        # Auto-training and prediction feature
        if auto_predict and interval == '1d':
            try:
                cached = _get_cached_model(symbol)
                if cached:
                    print(f"Using cached model for {symbol}", file=sys.stderr)
                    train_result = cached
                else:
                    print(f"Training new model with {symbol}...", file=sys.stderr)
                    train_result = train_random_forest_model(stock_data)
                    if 'error' not in train_result:
                        _set_cached_model(symbol, train_result)
                if 'error' in train_result:
                    print(f"Training failed: {train_result['error']}", file=sys.stderr)
                    # Add error status to response for insufficient data
                    stock_data.append({
                        "prediction": {
                            "symbol": symbol,
                            "status": "insufficient_data",
                            "error": train_result['error'],
                            "message": "Not enough historical data for AI prediction (minimum 50 data points with all features required)"
                        }
                    })
                else:
                    print(f"Model trained successfully with accuracy: {train_result['test_accuracy']:.2%}", file=sys.stderr)

                    prediction_result = predict_stock_recommendation(stock_data, train_result['model_data'])
                    if 'error' not in prediction_result:
                        # Add successful prediction to the response
                        stock_data.append({
                            "prediction": {
                                "symbol": symbol,
                                "status": "success",
                                "recommendation": prediction_result['recommendation'],
                                "confidence": prediction_result['confidence'],
                                "buy_probability": prediction_result['buy_probability'],
                                "sell_probability": prediction_result['sell_probability'],
                                "prediction_date": prediction_result['date'],
                                "current_price": prediction_result['current_price']
                            }
                        })
                    else:
                        print(f"Prediction failed: {prediction_result['error']}", file=sys.stderr)
                        # Add prediction error to response
                        stock_data.append({
                            "prediction": {
                                "symbol": symbol,
                                "status": "prediction_error",
                                "error": prediction_result['error'],
                                "message": "Model trained successfully but prediction failed"
                            }
                        })
            except Exception as e:
                print(f"Auto-prediction error: {str(e)}", file=sys.stderr)
        
        return stock_data
        
    except Exception as e:
        return {"error": f"Error fetching data: {str(e)}"}


def get_current_stock_price(symbol):
    """
    Get the most recent current price and day change for a stock symbol.
    """
    try:
        ticker = yf.Ticker(symbol)
        # Fetch 2 days to get previous close for day-change calculation
        hist = ticker.history(period="5d")
        if hist.empty:
            return {"error": f"No price data found for symbol: {symbol}"}

        current_price = float(hist["Close"].iloc[-1])
        result = {
            "symbol": symbol,
            "price": round(current_price, 2),
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        # Add previous close and day change if we have at least 2 data points
        if len(hist) >= 2:
            previous_close = float(hist["Close"].iloc[-2])
            change = current_price - previous_close
            change_percent = (change / previous_close) * 100 if previous_close != 0 else 0
            result["previousClose"] = round(previous_close, 2)
            result["change"] = round(change, 2)
            result["changePercent"] = round(change_percent, 2)

        return result
    except Exception as e:
        return {"error": f"Error fetching current price: {str(e)}"}


def get_fundamentals(symbol):
    """
    Fetch key fundamental data for a stock symbol from yfinance.
    """
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}

        def fmt_mcap(value):
            if value is None or not isinstance(value, (int, float)):
                return None
            if value >= 1e12:
                return f"${value / 1e12:.2f}T"
            if value >= 1e9:
                return f"${value / 1e9:.2f}B"
            if value >= 1e6:
                return f"${value / 1e6:.2f}M"
            return f"${value:,.0f}"

        def fmt_num(value, decimals=2):
            if value is None or not isinstance(value, (int, float)):
                return None
            return round(float(value), decimals)

        def fmt_pct(value):
            if value is None or not isinstance(value, (int, float)):
                return None
            return f"{value * 100:.2f}%"

        def fmt_vol(value):
            if value is None or not isinstance(value, (int, float)):
                return None
            if value >= 1e6:
                return f"{value / 1e6:.1f}M"
            if value >= 1e3:
                return f"{value / 1e3:.1f}K"
            return f"{value:,.0f}"

        fifty_two_week_low = fmt_num(info.get('fiftyTwoWeekLow'))
        fifty_two_week_high = fmt_num(info.get('fiftyTwoWeekHigh'))
        week_range = None
        if fifty_two_week_low is not None and fifty_two_week_high is not None:
            week_range = f"${fifty_two_week_low} – ${fifty_two_week_high}"

        return {
            "symbol": symbol.upper(),
            "marketCap": fmt_mcap(info.get('marketCap')),
            "trailingPE": fmt_num(info.get('trailingPE')),
            "forwardPE": fmt_num(info.get('forwardPE')),
            "trailingEps": fmt_num(info.get('trailingEps')),
            "dividendYield": fmt_pct(info.get('dividendYield')),
            "sector": info.get('sector') or None,
            "industry": info.get('industry') or None,
            "beta": fmt_num(info.get('beta')),
            "week52Range": week_range,
            "averageVolume": fmt_vol(info.get('averageVolume') or info.get('averageDailyVolume10Day')),
        }
    except Exception as e:
        return {"error": f"Error fetching fundamentals: {str(e)}"}


# ── Backtesting engine ─────────────────────────────────────────────────────
# Strategy defined as declarative JSON — no code execution.
# Safe for open API use.

# ponytail: no slippage, commission, partial fills, shorting. Add when needed.


RULE_OPS = {'>': lambda a, b: a > b, '<': lambda a, b: a < b, '>=': lambda a, b: a >= b, '<=': lambda a, b: a <= b}


def _get_col_val(df, i, spec):
    """Resolve a rule operand to a scalar value. spec is column name or literal number."""
    if isinstance(spec, (int, float)):
        return float(spec)
    col = str(spec)
    val = df.loc[i, col] if col in df.columns else None
    return float(val) if pd.notna(val) else None


def _check_rule(df, i, rule):
    """Check a single rule at row i. rule: {left, op, right}."""
    op_fn = RULE_OPS.get(rule['op'])
    if not op_fn:
        return None
    left_val = _get_col_val(df, i, rule['left'])
    right_val = _get_col_val(df, i, rule['right'])
    if left_val is None or right_val is None:
        return None
    return op_fn(left_val, right_val)


def _apply_rules(df, entry_rule, exit_rule, exit_mode, dca_periods, dca_unit):
    """Apply declarative strategy rules to generate buy/sell_pct signals.

    DCA sells only once per period (month/week), on the first bar where
    exit_rule triggers in that period. State persists across above/below
    transitions so DCA resumes rather than restarting on each dip.
    """
    df['buy'] = False
    df['sell_pct'] = 0.0

    prev_entry = None
    dca_state = None  # {'periods_left': N, 'remaining_pct': float, 'sold_periods': set}

    def _period_key(d):
        if dca_unit == 'month':
            return d.year * 12 + d.month
        if dca_unit == 'week':
            return d.isocalendar()[0] * 100 + d.isocalendar()[1]
        return d.toordinal()

    for i in range(len(df)):
        entry_val = _check_rule(df, i, entry_rule)
        exit_val = _check_rule(df, i, exit_rule)
        pkey = _period_key(pd.to_datetime(df.loc[i, 'Date']))

        # Entry on crossover day — blocked while DCA is active
        if entry_val is True and prev_entry is not True and dca_state is None:
            df.loc[i, 'buy'] = True
            dca_state = None

        # Exit
        if exit_val is True:
            if exit_mode == 'immediate':
                df.loc[i, 'sell_pct'] = 1.0
            else:
                # Init DCA state on first exit bar (or resume if still active)
                if dca_state is None:
                    dca_state = {'left': dca_periods, 'sold': set()}
                # Sell only once per period
                if pkey not in dca_state['sold'] and dca_state['left'] > 0:
                    dca_state['sold'].add(pkey)
                    df.loc[i, 'sell_pct'] = 1.0 / dca_state['left']
                    dca_state['left'] -= 1
                    if dca_state['left'] == 0:
                        dca_state = None  # DCA complete, allow new entries
                elif pkey not in dca_state['sold']:
                    # All periods sold, dump remaining
                    dca_state['sold'].add(pkey)
                    df.loc[i, 'sell_pct'] = 1.0
                    dca_state = None
        else:
            # Above — freeze DCA state (don't reset), will resume when dips again
            pass

        prev_entry = entry_val

    return df

    return df


def _run_simulation(df, capital):
    """Simulate trades from buy/sell columns. Supports sell_pct (0-1) for fractional exits.
    Returns (trades, equityCurve, final_value)."""
    trades = []
    equity_curve = []
    cash = float(capital)
    shares = 0.0
    entry_price = 0.0
    entry_date = None
    has_sell_pct = 'sell_pct' in df.columns

    for idx, row in df.iterrows():
        date_str = str(row['Date'])[:10]
        buy_signal = bool(row.get('buy', False))
        sell_signal = bool(row.get('sell', False))
        sell_fraction = float(row['sell_pct']) if has_sell_pct and pd.notna(row.get('sell_pct')) else 0.0

        # Exit(s) before entry
        if shares > 0:
            if sell_fraction > 0:
                sell_fraction = min(sell_fraction, 1.0)
            elif sell_signal:
                sell_fraction = 1.0

            if sell_fraction > 0:
                shares_to_sell = shares * sell_fraction
                exit_price = float(row['Close'])
                exit_value = shares_to_sell * exit_price
                trade_pnl = exit_value - (shares_to_sell * entry_price)
                trade_ret = ((exit_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0
                trades.append({
                    'entryDate': str(entry_date)[:10] if entry_date else None,
                    'entryPrice': round(float(entry_price), 2),
                    'exitDate': date_str,
                    'exitPrice': round(float(exit_price), 2),
                    'returnPct': round(float(trade_ret), 2),
                    'pnl': round(float(trade_pnl), 2),
                    'exitReason': 'signal',
                })
                cash += exit_value
                shares -= shares_to_sell

        # Entry (only with cash)
        if shares <= 0 and buy_signal and cash > 0:
            entry_price = float(row['Close'])
            entry_date = row['Date']
            shares = cash / entry_price
            cash = 0.0

        portfolio_value = cash + shares * float(row['Close'])
        equity_curve.append({'date': date_str, 'value': round(float(portfolio_value), 2)})

    # Liquidate remaining position at last close
    if shares > 0 and len(df) > 0:
        last = df.iloc[-1]
        exit_price = float(last['Close'])
        exit_value = shares * exit_price
        trade_pnl = exit_value - (shares * entry_price)
        trade_ret = ((exit_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0
        trades.append({
            'entryDate': str(entry_date)[:10] if entry_date else None,
            'entryPrice': round(float(entry_price), 2),
            'exitDate': str(last['Date'])[:10],
            'exitPrice': round(float(exit_price), 2),
            'returnPct': round(float(trade_ret), 2),
            'pnl': round(float(trade_pnl), 2),
            'exitReason': 'end_of_data',
        })
        cash += exit_value
        shares = 0
        portfolio_value = cash
        equity_curve[-1]['value'] = round(float(portfolio_value), 2)

    return trades, equity_curve, cash


def _compute_metrics(trades, equity_curve, initial_capital, final_value):
    """Calculate performance metrics from trades and equity curve."""
    total_return_pct = ((final_value - initial_capital) / initial_capital) * 100 if initial_capital > 0 else 0

    # CAGR
    cagr = 0.0
    if len(equity_curve) >= 2:
        try:
            first = datetime.strptime(equity_curve[0]['date'], '%Y-%m-%d')
            last = datetime.strptime(equity_curve[-1]['date'], '%Y-%m-%d')
            days = (last - first).days
            years = days / 365.25
            if years > 0 and initial_capital > 0 and final_value > 0:
                cagr = (pow(final_value / initial_capital, 1 / years) - 1) * 100
        except (ValueError, ZeroDivisionError):
            pass

    # Sharpe from daily equity curve returns
    sharpe = 0.0
    if len(equity_curve) > 1:
        vals = [e['value'] for e in equity_curve]
        daily_rets = [(vals[i] - vals[i - 1]) / vals[i - 1] for i in range(1, len(vals)) if vals[i - 1] > 0]
        if daily_rets:
            mean_r = np.mean(daily_rets)
            std_r = np.std(daily_rets)
            if std_r > 0:
                sharpe = round(float((mean_r / std_r) * math.sqrt(252)), 2)

    # Max drawdown
    max_dd = 0.0
    if equity_curve:
        peak = equity_curve[0]['value']
        for e in equity_curve:
            v = e['value']
            if v > peak:
                peak = v
            dd = (peak - v) / peak * 100 if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

    # Trade metrics
    num_trades = len(trades)
    winning = [t for t in trades if t['pnl'] > 0]
    losing = [t for t in trades if t['pnl'] <= 0]
    win_rate = len(winning) / num_trades if num_trades > 0 else 0
    gross_profit = sum(t['pnl'] for t in winning)
    gross_loss = abs(sum(t['pnl'] for t in losing))
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (99.99 if gross_profit > 0 else 0)
    avg_return = round(float(np.mean([t['returnPct'] for t in trades])), 2) if trades else 0
    avg_loss = round(float(np.mean([t['returnPct'] for t in losing])), 2) if losing else 0

    return {
        'totalReturn': round(float(total_return_pct), 2),
        'cagr': round(float(cagr), 2),
        'sharpe': sharpe,
        'maxDrawdown': round(float(max_dd), 2),
        'winRate': round(float(win_rate), 4),
        'numTrades': num_trades,
        'avgReturn': avg_return,
        'avgLoss': avg_loss,
        'profitFactor': profit_factor,
        'totalReturnPct': round(float(total_return_pct), 2),
    }


def run_backtest(symbol, strategy_config, capital=10000, date_range='2y', interval='1d'):
    """Execute backtest from declarative strategy config dict.

    Config format:
    {
        "entry": {"left": "Close", "op": ">", "right": "MA_200"},
        "exit_condition": {"left": "Close", "op": "<", "right": "MA_200"},
        "exit_mode": "dca",
        "dca_periods": 3,
        "dca_unit": "month"
    }

    If strategy_config is a string, parse as JSON.
    """
    if isinstance(strategy_config, str):
        strategy_config = json.loads(strategy_config)

    entry_rule = strategy_config['entry']
    exit_rule = strategy_config.get('exit_condition', strategy_config.get('exit', {}))
    exit_mode = strategy_config.get('exit_mode', 'immediate')
    dca_periods = int(strategy_config.get('dca_periods', 3))
    dca_unit = strategy_config.get('dca_unit', 'month')

    try:
        raw = get_stock_price_history(symbol, date_range, interval, auto_predict=False)
        if isinstance(raw, dict) and 'error' in raw:
            return {'error': raw['error']}

        df = pd.DataFrame(raw)
        if df.empty:
            return {'error': f'No data found for {symbol}'}

        df['Date'] = pd.to_datetime(df['Date'])
        df.sort_values('Date', inplace=True)
        df.reset_index(drop=True, inplace=True)

        # Compute standard MAs (10-200) plus any MA referenced in config
        needed_periods = set([10, 20, 50, 150, 200])
        for rule in [entry_rule, exit_rule]:
            for key in ['left', 'right']:
                val = rule.get(key, '')
                if isinstance(val, str) and val.startswith('MA_'):
                    try:
                        needed_periods.add(int(val.split('_')[1]))
                    except (IndexError, ValueError):
                        pass

        for period in sorted(needed_periods):
            col = f'MA_{period}'
            if col not in df.columns:
                df[col] = df['Close'].rolling(window=period, min_periods=min(period, 20)).mean()

        # Apply strategy rules
        df = _apply_rules(df, entry_rule, exit_rule, exit_mode, dca_periods, dca_unit)

        # Trim NaN rows where rules couldn't evaluate
        valid = df.dropna(subset=['buy', 'sell_pct'])
        if valid.empty:
            return {'error': 'No valid rows after NaN removal — data may be insufficient'}

        trades, equity_curve, final_value = _run_simulation(valid, capital)
        metrics = _compute_metrics(trades, equity_curve, capital, final_value)

        return {
            'metrics': metrics,
            'trades': trades,
            'equityCurve': equity_curve,
            'error': None,
        }

    except json.JSONDecodeError as e:
        return {'error': f'Invalid strategy JSON: {str(e)}'}
    except Exception as e:
        return {'error': f'Backtest failed: {str(e)}'}

def train_random_forest_model(stock_data):
    """
    Train a Random Forest model using pre-fetched stock data from a single symbol.
    Only uses data points where all features are complete (no None values).
    """
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import accuracy_score, classification_report
        import numpy as np
        
        print("Training Random Forest model with single symbol data...", file=sys.stderr)
        
        # Filter for complete data points (no None values in features)
        complete_data = []
        feature_fields = ['MA50_above_MA150', 'MA150_above_MA200', 'Price_above_MA50', 
                        'Volume_20MA_uptrend', 'MA200_uptrend_past_month', 'MA200_uptrend_past_6months',
                        'MA200_uptrend_past_year', 'Price_above_52week_low_30pct', 
                        'Price_within_25pct_of_52week_high', 'Week_Price_Range', 'Month_Price_Range',
                        'Price_Change_1D', 'Price_Change_1W', 'Price_Change_1M', 'Price_Change_3M',
                        'Price_more_rise_than_fall_month']
        
        for row in stock_data:
            if row.get('Label') is not None:  # Must have a label
                # Check all feature fields are not None
                features_complete = True
                for field in feature_fields:
                    if row.get(field) is None:
                        features_complete = False
                        break
                
                if features_complete:
                    complete_data.append(row)
        
        if len(complete_data) < 50:  # Minimum data points
            return {"error": f"Insufficient training data. Only {len(complete_data)} complete records found. Need at least 50."}
        
        # Data stays sorted by date (ascending) — stock_data was sorted at line 166,
        # so complete_data is also chronologically ordered.
        print(f"Using {len(complete_data)} data points for training (time-series ordered)", file=sys.stderr)
        
        # Prepare features and labels
        feature_names = ['MA50_above_MA150', 'MA150_above_MA200', 'Price_above_MA50', 
                        'Volume_20MA_uptrend', 'MA200_uptrend_past_month', 'MA200_uptrend_past_6months',
                        'MA200_uptrend_past_year', 'Price_above_52week_low_30pct', 
                        'Price_within_25pct_of_52week_high', 'Week_Price_Range', 'Month_Price_Range',
                        'Price_Change_1D', 'Price_Change_1W', 'Price_Change_1M', 'Price_Change_3M',
                        'Price_more_rise_than_fall_month']
        
        X = []
        y = []
        
        for row in complete_data:
            features = [row[feature] for feature in feature_names]
            X.append(features)
            y.append(row['Label'])
        
        X = np.array(X)
        y = np.array(y)
        
        # Time-series split: train on first 80%, test on last 20%
        # Data is sorted by date ascending, so this respects temporal order
        # (no future data leaks into training)
        split_idx = int(len(X) * 0.8)
        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]
        
        # Train Random Forest
        print("Training Random Forest...", file=sys.stderr)
        rf_model = RandomForestClassifier(
            n_estimators=200,
            max_depth=15,
            min_samples_split=10,
            min_samples_leaf=5,
            random_state=42,
            class_weight='balanced'
        )
        
        rf_model.fit(X_train, y_train)
        
        # Evaluate model
        train_accuracy = accuracy_score(y_train, rf_model.predict(X_train))
        test_accuracy = accuracy_score(y_test, rf_model.predict(X_test))
        
        print(f"Training Accuracy: {train_accuracy:.4f}", file=sys.stderr)
        print(f"Testing Accuracy: {test_accuracy:.4f}", file=sys.stderr)
        
        # Feature importance (BaggingClassifier doesn't expose it directly,
        # so average from individual tree estimators)
        if hasattr(rf_model, 'feature_importances_'):
            feature_importance = list(zip(feature_names, rf_model.feature_importances_))
        elif hasattr(rf_model, 'estimators_'):
            # Average importance across all base estimators
            importances = np.mean([est.feature_importances_ for est in rf_model.estimators_], axis=0)
            feature_importance = list(zip(feature_names, importances))
        else:
            feature_importance = list(zip(feature_names, [0]*len(feature_names)))
        feature_importance.sort(key=lambda x: x[1], reverse=True)
        
        print("\nTop 10 Most Important Features:", file=sys.stderr)
        for feature, importance in feature_importance[:10]:
            print(f"  {feature}: {importance:.4f}", file=sys.stderr)
        
        model_data = {
            'model': rf_model,
            'feature_names': feature_names,
            'train_accuracy': train_accuracy,
            'test_accuracy': test_accuracy,
            'feature_importance': feature_importance,
            'training_symbols': ["single_symbol"],
            'total_training_points': len(complete_data)
        }

        print("\nModel trained in memory", file=sys.stderr)
        
        return {
            'status': 'success',
            'model_data': model_data,
            'train_accuracy': train_accuracy,
            'test_accuracy': test_accuracy,
            'feature_importance': feature_importance,
            'training_points': len(complete_data),
            'symbols_used': 1
        }
        
    except ImportError as e:
        return {"error": f"Required libraries not installed: {str(e)}. Please install scikit-learn."}
    except Exception as e:
        return {"error": f"Training failed: {str(e)}"}

def predict_stock_recommendation(stock_data, model_data):
    """
    Use trained Random Forest model to predict buy/sell recommendation for a stock.
    Uses the most recent complete data point from pre-fetched data.
    """
    try:
        import numpy as np
        
        rf_model = model_data['model']
        feature_names = model_data['feature_names']
        
        # Find the most recent complete data point from pre-fetched data
        latest_complete = None
        for row in reversed(stock_data):  # Start from most recent
            # Skip prediction entries
            if 'prediction' in row:
                continue
                
            # Check if all features are available (not None)
            features_complete = True
            for feature in feature_names:
                if row.get(feature) is None:
                    features_complete = False
                    break
            
            if features_complete:
                latest_complete = row
                break
        
        if latest_complete is None:
            return {"error": f"No complete feature data available"}
        
        # Prepare features for prediction
        features = [latest_complete[feature] for feature in feature_names]
        features_array = np.array([features])
        
        # Make prediction
        prediction = rf_model.predict(features_array)[0]
        prediction_proba = rf_model.predict_proba(features_array)[0]
        
        # Get confidence scores
        sell_confidence = prediction_proba[0] * 100
        buy_confidence = prediction_proba[1] * 100
        
        recommendation = "BUY" if prediction == 1 else "SELL"
        confidence = max(sell_confidence, buy_confidence)
        
        return {
            'date': latest_complete['Date'],
            'recommendation': recommendation,
            'confidence': round(confidence, 2),
            'buy_probability': round(buy_confidence, 2),
            'sell_probability': round(sell_confidence, 2),
            'current_price': latest_complete['Close'],
            'features_used': dict(zip(feature_names, features))
        }
        
    except Exception as e:
        return {"error": f"Prediction failed: {str(e)}"}


# ── FastAPI service ──────────────────────────────────────────────────────────
# Run with: python stock_data.py serve
# Exposes two endpoints used by the Express backend instead of execFile spawning.

def _make_fastapi_app():
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel

    service = FastAPI(title="Stock Analysis Service")

    class HistoryRequest(BaseModel):
        symbol: str
        date_range: str = 'max'
        interval: str = '1d'
        auto_predict: bool = False

    class PriceRequest(BaseModel):
        symbol: str

    class BacktestRequest(BaseModel):
        symbol: str
        strategy_config: dict
        capital: float = 10000
        date_range: str = '2y'
        interval: str = '1d'

    @service.get("/health")
    def health():
        return {"status": "ok"}

    @service.post("/stock_history")
    def stock_history(req: HistoryRequest):
        result = get_stock_price_history(req.symbol, req.date_range, req.interval, req.auto_predict)
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result

    @service.post("/current_price")
    def current_price(req: PriceRequest):
        result = get_current_stock_price(req.symbol)
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result

    @service.post("/fundamentals")
    def fundamentals(req: PriceRequest):
        result = get_fundamentals(req.symbol)
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result

    @service.post("/backtest")
    def backtest(req: BacktestRequest):
        import subprocess, os
        # Run backtest in subprocess so we can kill on timeout
        script = (
            "import sys, json\n"
            f"sys.path.insert(0, {json.dumps(os.path.dirname(__file__) or '.')})\n"
            "from stock_data import run_backtest\n"
            "params = json.loads(sys.stdin.read())\n"
            "result = run_backtest(**params)\n"
            "print(json.dumps(result))\n"
        )
        params = {
            'symbol': req.symbol,
            'strategy_config': req.strategy_config,
            'capital': req.capital,
            'date_range': req.date_range,
            'interval': req.interval,
        }
        proc = subprocess.Popen(
            [sys.executable, '-c', script],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            stdout, stderr = proc.communicate(input=json.dumps(params).encode(), timeout=30)
            if stderr:
                sys.stderr.write(f'[backtest-worker] {stderr.decode().strip()}\n')
            result = json.loads(stdout.decode())
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise HTTPException(status_code=408, detail='Backtest timed out (30s)')
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail='Backtest worker returned invalid JSON')

        if isinstance(result, dict) and result.get('error'):
            raise HTTPException(status_code=400, detail=result['error'])
        return result

    @service.get("/model/status/{symbol}")
    def model_status(symbol: str):
        sym = symbol.upper()
        entry = _model_cache.get(sym)
        if entry:
            cached = entry['model_data']
            return {
                "symbol": sym,
                "cached": True,
                "trainedAt": entry['trained_at'].isoformat() if entry.get('trained_at') else None,
                "testAccuracy": cached.get('test_accuracy'),
                "featureImportance": cached.get('feature_importance', []),
            }
        return {"symbol": sym, "cached": False}

    @service.post("/model/retrain/{symbol}")
    def model_retrain(symbol: str):
        # Evict cache and force a retrain on next stock_history call
        sym = symbol.upper()
        if sym in _model_cache:
            del _model_cache[sym]
        path = _get_cache_path(sym)
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass
        return {"symbol": sym, "message": "Cache cleared. Model will be retrained on next prediction request."}

    return service

app = _make_fastapi_app()

if __name__ == "__main__":

    function_name = sys.argv[1] if len(sys.argv) > 1 else ""

    if function_name == "serve":
        import uvicorn
        host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
        port = int(sys.argv[3]) if len(sys.argv) > 3 else 8000
        print(f"Starting Stock Analysis FastAPI service on {host}:{port}", file=sys.stderr)
        uvicorn.run(app, host=host, port=port)

    elif function_name == "get_stock_price_history":
        if len(sys.argv) < 3:
            result = {"error": "Symbol required for get_stock_price_history"}
        else:
            symbol = sys.argv[2]
            date_range = sys.argv[3] if len(sys.argv) > 3 else '2y'
            interval = sys.argv[4] if len(sys.argv) > 4 else '1d'
            auto_predict = sys.argv[5].lower() == 'true' if len(sys.argv) > 5 else False
            result = get_stock_price_history(symbol, date_range, interval, auto_predict)
        print(json.dumps(result, separators=(',', ':')))

    elif function_name == "get_current_stock_price":
        if len(sys.argv) < 3:
            result = {"error": "Symbol required for get_current_stock_price"}
        else:
            symbol = sys.argv[2]
            result = get_current_stock_price(symbol)
        print(json.dumps(result, separators=(',', ':')))

    else:
        print(json.dumps({"error": f"Unknown function: {function_name}"}, separators=(',', ':')))

