import requests
import yfinance as yf
import pandas as pd
import sys
import json
import queue
from datetime import datetime, timedelta, date

def get_stock_price_history(symbol, date_range='max', interval='1d', auto_predict=False): 
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
        
        hist['200MA'] = hist['Close'].rolling(window=200, min_periods=200).mean()
        hist['150MA'] = hist['Close'].rolling(window=150, min_periods=150).mean()
        hist['50MA'] = hist['Close'].rolling(window=50, min_periods=50).mean()
        hist['20MA'] = hist['Close'].rolling(window=20, min_periods=20).mean()
        hist['10MA'] = hist['Close'].rolling(window=10, min_periods=10).mean()
        
        # Volume moving average
        hist['Volume_20MA'] = hist['Volume'].rolling(window=20, min_periods=20).mean()

        if interval == '1d':
            
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
            
            # Create buy/sell label: 1 = buy (price up by more than 1%), 0 = sell (price up by 1% or less)
            hist['Label'] = (hist['Future_Return'] > 0.01).astype(int)


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
                "Volume_20MA": round(float(row['Volume_20MA']), 0) if pd.notna(row['Volume_20MA']) else None,
                "200MA": round(float(row['200MA']), 2) if pd.notna(row['200MA']) else None,
                "150MA": round(float(row['150MA']), 2) if pd.notna(row['150MA']) else None,
                "50MA": round(float(row['50MA']), 2) if pd.notna(row['50MA']) else None,
                "20MA": round(float(row['20MA']), 2) if pd.notna(row['20MA']) else None,
                "10MA": round(float(row['10MA']), 2) if pd.notna(row['10MA']) else None
            }
            if interval == '1d':
                data_point["MA50_above_MA150"] = int(row['MA50_above_MA150']) if pd.notna(row['MA50_above_MA150']) else None
                data_point["MA150_above_MA200"] = int(row['MA150_above_MA200']) if pd.notna(row['MA150_above_MA200']) else None
                data_point["Price_above_MA50"] = int(row['Price_above_MA50']) if pd.notna(row['Price_above_MA50']) else None
                data_point["Volume_20MA_uptrend"] = int(row['Volume_20MA_uptrend']) if pd.notna(row['Volume_20MA_uptrend']) else None
                data_point["MA200_uptrend_past_month"] = int(row['MA200_uptrend_past_month']) if pd.notna(row['MA200_uptrend_past_month']) else None
                data_point["MA200_uptrend_past_6months"] = int(row['MA200_uptrend_past_6months']) if pd.notna(row['MA200_uptrend_past_6months']) else None
                data_point["MA200_uptrend_past_year"] = int(row['MA200_uptrend_past_year']) if pd.notna(row['MA200_uptrend_past_year']) else None
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
                import os
                model_file = 'stock_rf_model.pkl'
                
                # Always train a new model with the current symbol using already fetched data
                print(f"Training new model with {symbol}...", file=sys.stderr)
                train_result = train_random_forest_model(stock_data)
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
                    
                    # Make prediction if model exists
                    if os.path.exists(model_file):
                        prediction_result = predict_stock_recommendation(stock_data, model_file)
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
                    else:
                        # Model file doesn't exist (shouldn't happen after successful training)
                        stock_data.append({
                            "prediction": {
                                "symbol": symbol,
                                "status": "model_error",
                                "error": "Model file not found after training",
                                "message": "Training completed but model file is missing"
                            }
                        })
            except Exception as e:
                print(f"Auto-prediction error: {str(e)}", file=sys.stderr)
        
        return stock_data
        
    except Exception as e:
        return {"error": f"Error fetching data: {str(e)}"}


def train_random_forest_model(stock_data):
    """
    Train a Random Forest model using pre-fetched stock data from a single symbol.
    Only uses data points where all features are complete (no None values).
    """
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import accuracy_score, classification_report
        import pickle
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
        
        # Randomly select 300 data points for training
        import random
        random.seed(42)  # For reproducible results
        if len(complete_data) > 300:
            complete_data = random.sample(complete_data, 300)
        
        print(f"Using {len(complete_data)} randomly selected data points for training", file=sys.stderr)
        
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
        
        # Split the data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        
        # Train Random Forest
        print("Training Random Forest...", file=sys.stderr)
        rf_model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            min_samples_split=20,
            min_samples_leaf=10,
            random_state=42,
            class_weight='balanced'
        )
        
        rf_model.fit(X_train, y_train)
        
        # Evaluate model
        train_accuracy = accuracy_score(y_train, rf_model.predict(X_train))
        test_accuracy = accuracy_score(y_test, rf_model.predict(X_test))
        
        print(f"Training Accuracy: {train_accuracy:.4f}", file=sys.stderr)
        print(f"Testing Accuracy: {test_accuracy:.4f}", file=sys.stderr)
        
        # Feature importance
        feature_importance = list(zip(feature_names, rf_model.feature_importances_))
        feature_importance.sort(key=lambda x: x[1], reverse=True)
        
        print("\nTop 10 Most Important Features:", file=sys.stderr)
        for feature, importance in feature_importance[:10]:
            print(f"  {feature}: {importance:.4f}", file=sys.stderr)
        
        # Save model
        model_data = {
            'model': rf_model,
            'feature_names': feature_names,
            'train_accuracy': train_accuracy,
            'test_accuracy': test_accuracy,
            'feature_importance': feature_importance,
            'training_symbols': ["single_symbol"],
            'total_training_points': len(complete_data)
        }
        
        with open('stock_rf_model.pkl', 'wb') as f:
            pickle.dump(model_data, f)
        
        print("\nModel saved as 'stock_rf_model.pkl'", file=sys.stderr)
        
        return {
            'status': 'success',
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

def predict_stock_recommendation(stock_data, model_file='stock_rf_model.pkl'):
    """
    Use trained Random Forest model to predict buy/sell recommendation for a stock.
    Uses the most recent complete data point from pre-fetched data.
    """
    try:
        import pickle
        import numpy as np
        
        # Load the trained model
        with open(model_file, 'rb') as f:
            model_data = pickle.load(f)
        
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
        
    except FileNotFoundError:
        return {"error": f"Model file '{model_file}' not found. Please train a model first."}
    except Exception as e:
        return {"error": f"Prediction failed: {str(e)}"}


if __name__ == "__main__":
    
    function_name = sys.argv[1]
    
    if function_name == "get_stock_price_history":
        if len(sys.argv) < 3:
            result = {"error": "Symbol required for get_stock_price_history"}
        else:
            symbol = sys.argv[2]
            # Optional parameters: date_range, interval, auto_predict
            date_range = sys.argv[3] if len(sys.argv) > 3 else '2y'
            interval = sys.argv[4] if len(sys.argv) > 4 else '1d'
            auto_predict = sys.argv[5].lower() == 'true' if len(sys.argv) > 5 else False
            result = get_stock_price_history(symbol, date_range, interval, auto_predict)
    
    else:
        result = {"error": f"Unknown function: {function_name}"}
    
    print(json.dumps(result, separators=(',', ':')))