# ANALYSIS — Python ML Engine

## OVERVIEW
Monolithic Python script: fetches OHLCV data via yfinance, computes 5 price MAs + volume MA, engineers 16 binary/numeric ML features, trains a RandomForest classifier, appends a prediction to the response. Also exposes a **FastAPI HTTP service** (port 8000) used by the Express backend instead of spawning a new process per request.

## STRUCTURE
```
analysis/
├── stock_data.py         # Everything: data fetch, features, ML, FastAPI app, CLI
└── stock_rf_model.pkl    # Trained model (pickle, written to CWD)
```

## FUNCTIONS
| Function | CLI? | HTTP? | Description |
|----------|------|-------|-------------|
| `get_stock_price_history(symbol, date_range, interval, auto_predict)` | ✅ | `POST /stock_history` | Fetch OHLCV, compute MAs + features, optionally train + predict |
| `get_current_stock_price(symbol)` | ✅ | `POST /current_price` | Fetch latest closing price for a symbol |
| `train_random_forest_model(stock_data)` | ❌ internal only | — | Train RF on pre-fetched data list; saves `.pkl` to CWD |
| `predict_stock_recommendation(stock_data, model_file)` | ❌ internal only | — | Load `.pkl`, predict using most recent complete row |

**⚠ `train_random_forest_model` and `predict_stock_recommendation` are NOT dispatched via CLI or HTTP** — they are internal helpers called by `get_stock_price_history` when `auto_predict=true`.

## FASTAPI SERVICE
The preferred way to run the analysis engine. Express backend calls it via HTTP instead of spawning a Python process per request.

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/health` | GET | — | Returns `{"status": "ok"}` |
| `/stock_history` | POST | `{symbol, date_range, interval, auto_predict}` | Full OHLCV + MAs + ML features + optional prediction |
| `/current_price` | POST | `{symbol}` | Latest closing price |

Start with: `python stock_data.py serve` (defaults to `127.0.0.1:8000`)  
Custom host/port: `python stock_data.py serve 0.0.0.0 8001`

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Data fetch + MAs | `stock_data.py:9-50` | yfinance pull, 200/150/50/20/10 MA, Volume_20MA |
| Feature engineering | `stock_data.py:36-118` | 16 ML features + Label — daily interval only |
| Data serialisation | `stock_data.py:120-165` | Converts DataFrame to list of dicts; appends prediction dict at end |
| Auto-predict flow | `stock_data.py:170-232` | Calls train then predict; appends `{"prediction": {...}}` to list |
| RF training | `stock_data.py:255-379` | `train_random_forest_model(stock_data)` |
| RF prediction | `stock_data.py:381-446` | `predict_stock_recommendation(stock_data, model_file)` |
| FastAPI app | `stock_data.py` (`_make_fastapi_app`) | Defines `/health`, `/stock_history`, `/current_price` |
| CLI dispatch | `stock_data.py` (`__main__`) | `serve`, `get_stock_price_history`, `get_current_stock_price` |

## CONVENTIONS
- **FastAPI is primary**: Express calls `POST /stock_history` on the running service. The CLI still works for direct testing.
- **Pure JSON stdout (CLI only)**: When using CLI mode, all output must be valid JSON. Use `sys.stderr` for logging.
- **Model persistence**: `stock_rf_model.pkl` written to CWD via pickle. When the service runs from `analysis/`, model ends up at `analysis/stock_rf_model.pkl`.
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
- **Pickle to CWD**: Model location depends on working directory — `analysis/stock_rf_model.pkl` when service runs from `analysis/`.
- **Monolithic**: Single file handles fetch, feature engineering, training, prediction, FastAPI, and CLI — no separation of concerns.

## COMMANDS
```bash
# Start FastAPI service (used by Express backend)
python stock_data.py serve                          # 127.0.0.1:8000
python stock_data.py serve 0.0.0.0 8001            # custom host/port

# Direct CLI (for testing only)
python stock_data.py get_stock_price_history AAPL max 1d true
python stock_data.py get_stock_price_history AAPL 1y 1wk false
python stock_data.py get_current_stock_price AAPL
```

## DEPENDENCIES
```
yfinance       # OHLCV data
pandas         # DataFrame operations
numpy          # Array operations for ML
scikit-learn   # RandomForestClassifier (lazy import inside train function)
fastapi        # HTTP service framework
uvicorn        # ASGI server for FastAPI
```
