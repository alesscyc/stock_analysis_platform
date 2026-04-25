# ANALYSIS — Python ML Engine

## OVERVIEW
Monolithic Python script: fetches OHLCV data via yfinance, computes 5 price MAs + volume MA, engineers 16 binary/numeric ML features, trains a RandomForest classifier, appends a prediction to the response. All in one 473-line file.

## STRUCTURE
```
analysis/
├── stock_data.py         # 473 lines — everything
└── stock_rf_model.pkl    # Trained model (pickle, written to CWD)
```

## FUNCTIONS
| Function | CLI? | Description |
|----------|------|-------------|
| `get_stock_price_history(symbol, date_range, interval, auto_predict)` | ✅ | Fetch OHLCV, compute MAs + features, optionally train + predict |
| `get_current_stock_price(symbol)` | ✅ | Fetch latest closing price for a symbol |
| `train_random_forest_model(stock_data)` | ❌ internal only | Train RF on pre-fetched data list; saves `.pkl` to CWD |
| `predict_stock_recommendation(stock_data, model_file)` | ❌ internal only | Load `.pkl`, predict using most recent complete row |

**⚠ `train_random_forest_model` and `predict_stock_recommendation` are NOT dispatched via `__main__`** — they are internal helpers called by `get_stock_price_history` when `auto_predict=true`. Do not attempt to call them from the CLI.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Data fetch + MAs | `stock_data.py:9-50` | yfinance pull, 200/150/50/20/10 MA, Volume_20MA |
| Feature engineering | `stock_data.py:36-118` | 16 ML features + Label — daily interval only |
| Data serialisation | `stock_data.py:120-165` | Converts DataFrame to list of dicts; appends prediction dict at end |
| Auto-predict flow | `stock_data.py:170-232` | Calls train then predict; appends `{"prediction": {...}}` to list |
| RF training | `stock_data.py:255-379` | `train_random_forest_model(stock_data)` |
| RF prediction | `stock_data.py:381-446` | `predict_stock_recommendation(stock_data, model_file)` |
| CLI dispatch | `stock_data.py:449-472` | `__main__` — only `get_stock_price_history` and `get_current_stock_price` |

## CONVENTIONS
- **Pure JSON stdout**: ALL output must be valid JSON. Never use `print()` for debugging — breaks the backend `execFile` parser. Use `sys.stderr` exclusively for logging.
- **CLI interface**: `python stock_data.py <function_name> <symbol> [date_range] [interval] [auto_predict]`.
- **Model persistence**: `stock_rf_model.pkl` written to CWD via pickle. When called by Express, CWD is `backend/`, so model ends up at `backend/stock_rf_model.pkl`.
- **Training params**: `n_estimators=100, max_depth=10, min_samples_split=20, min_samples_leaf=10, class_weight='balanced'`, `random_state=42`.
- **BUY label**: `future_return > 0.01` (22-day forward return > 1%).
- **Min training data**: 50 complete records required. Randomly samples up to 300 with `random.seed(42)`.
- **Features only for `interval=1d`**: All 16 ML features and `Label` are `None` for `1wk`/`1mo` intervals.

## 16 ML FEATURES
All binary (0/1) unless noted:

| Feature | Type | Description |
|---------|------|-------------|
| `MA50_above_MA150` | binary | 50MA > 150MA |
| `MA150_above_MA200` | binary | 150MA > 200MA |
| `Price_above_MA50` | binary | Close > 50MA |
| `Volume_20MA_uptrend` | binary | ≥70% of past 10 days had rising 20-day volume MA |
| `MA200_uptrend_past_month` | binary | ≥90% of past 22 days had rising 200MA |
| `MA200_uptrend_past_6months` | binary | ≥90% of past 132 days had rising 200MA |
| `MA200_uptrend_past_year` | binary | ≥90% of past 252 days had rising 200MA |
| `Price_above_52week_low_30pct` | binary | Price ≥30% above 52-week low |
| `Price_within_25pct_of_52week_high` | binary | Price within 25% of 52-week high |
| `Week_Price_Range` | float | High − Low over past 5 trading days |
| `Month_Price_Range` | float | High − Low over past 22 trading days |
| `Price_Change_1D` | float | % change vs 1 day ago |
| `Price_Change_1W` | float | % change vs 5 days ago |
| `Price_Change_1M` | float | % change vs 22 days ago |
| `Price_Change_3M` | float | % change vs 66 days ago |
| `Price_more_rise_than_fall_month` | binary | More up-days than down-days in past 22 trading days |

## KEY ANTI-PATTERNS & RISKS
- **Retrained every request**: `auto_predict=true` trains a fresh RF model each call — expensive, non-deterministic, race condition risk with `.pkl` writes.
- **Pickle to CWD**: Model location depends on working directory — `backend/stock_rf_model.pkl` when run via Express, `analysis/stock_rf_model.pkl` when run directly.
- **No requirements.txt**: Install manually: `pip install yfinance pandas numpy scikit-learn requests`.
- **Monolithic**: Single file handles fetch, feature engineering, training, prediction, and CLI — no separation of concerns.
- **JSON on stdout only**: Any stray debug `print()` breaks the backend parser. Use `sys.stderr` exclusively.
- **`queue` import unused**: `import queue` exists at the top but is never used — harmless but misleading.
- **`requests` import unused in main flow**: `import requests` is present but never called (yfinance handles HTTP internally).

## COMMANDS
```bash
# Fetch OHLCV + MAs + ML features (+ AI prediction if auto_predict=true)
python stock_data.py get_stock_price_history AAPL max 1d true
python stock_data.py get_stock_price_history AAPL 1y 1wk false

# Get current price only
python stock_data.py get_current_stock_price AAPL
```

## DEPENDENCIES
```
yfinance       # OHLCV data
pandas         # DataFrame operations
numpy          # Array operations for ML
scikit-learn   # RandomForestClassifier (lazy import inside train function)
requests       # Present in imports but not directly called
```
