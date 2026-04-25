# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-06  
**Branch:** main

## OVERVIEW
Full-stack stock analysis platform: React/Vite frontend (lightweight-charts) → Express API with IB Gateway bridge → Python ML engine (yfinance + scikit-learn RandomForest). Single-page UI, real trading via Interactive Brokers, no auth, no routing.

## STRUCTURE
```
stock_analysis_platform/
├── frontend/               # Vite + React 19, ESM, lightweight-charts v5.1
│   ├── component/          # ⚠ Components live HERE (not src/component/)
│   ├── src/                # main.jsx → App.jsx (root)
│   └── dist/               # Built output (gitignored)
├── backend/                # Express 5.1, CJS (require), 476 lines
│   ├── server.js           # API routes + IB Gateway bridge + Python proxy
│   └── .env                # ⚠ Required: IB_HOST, IB_PORT, IB_CLIENT_ID, timeouts
└── analysis/               # Python ML engine, 460 lines
    ├── stock_data.py       # Fetch + 16 indicators + RF training + CLI
    └── requirements.txt    # ⚠ Missing (install manually)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Chart widget + MA toggles | `frontend/component/StockChart.jsx` | lightweight-charts candlestick, volume bars, 5 MA overlays |
| Search + fetch logic | `frontend/src/App.jsx` | State root, ticker lookup orchestration |
| Stock data API route | `backend/server.js` | `GET /api/stock/:symbol?date_range&interval&auto_predict` |
| Trading routes | `backend/server.js` | `POST /api/orders`, `GET /api/portfolio`, `GET /api/orders/pending` |
| IB Gateway bridge | `backend/server.js` | Connection mgmt, event handlers, order queueing, portfolio caching |
| Python CLI dispatch | `analysis/stock_data.py` | Functions: `get_stock_price_history`, `train_random_forest_model`, `predict_stock_recommendation` |

## DATA FLOW
```
SearchBar (Enter) → App.jsx fetches /api/stock/:symbol?auto_predict=true
  → backend shells Python: execFile('python', ['analysis/stock_data.py', 'get_stock_price_history', ...])
  → Python outputs JSON (OHLCV + 16 indicators + ML prediction) to stdout
  → backend caches (5 min TTL) and returns to frontend
  → StockChart renders candlesticks, MAs, volume; displays AI recommendation panel

BUY button (TradeDialog) → POST /api/orders
  → backend validates and queues order to IB Gateway
  → IB Gateway executes real trade, updates portfolio cache

UI portfolio/orders queries → GET /api/portfolio or /api/orders/pending
  → Express returns IB Gateway cached snapshot
```

## SETUP & COMMANDS
```bash
# Install all dependencies
cd frontend && npm install
cd ../backend && npm install
cd ../analysis && pip install yfinance pandas numpy scikit-learn ta

# Configure backend (required)
# backend/.env must have: IB_HOST, IB_PORT, IB_CLIENT_ID, IB_PORTFOLIO_SYNC_TIMEOUT_MS, IB_ORDER_ID_WAIT_TIMEOUT_MS

# Run (3 terminals)
cd frontend && npm run dev                    # Dev server on port 5173
cd backend && npm run dev                     # API on port 3001 (nodemon auto-restart)
python analysis/stock_data.py train_random_forest_model AAPL 1y 1d  # (optional: pre-train model)

# Direct Python CLI (for testing analysis)
python analysis/stock_data.py get_stock_price_history AAPL 1y 1d true
python analysis/stock_data.py train_random_forest_model AAPL 1y 1d
python analysis/stock_data.py predict_stock_recommendation AAPL 1y 1d
```

## CONVENTIONS
- **Frontend**: ESM (`"type": "module"`), default exports only, relative imports from `../component/`.
- **Backend**: CJS (`require()`), no routes dir, all logic in `server.js`.
- **Python**: Must output **pure JSON** to stdout. No `print()` for debugging — breaks `execFile` parser. Use `sys.stderr` for errors.
- **Charting**: Switched from Chart.js to lightweight-charts (v5.1.0) for better candlestick perf. Import: `createChart`, `CandlestickSeries`, `HistogramSeries`, `LineSeries`.
- **Case-sensitive**: Component imports must match filenames exactly (`SearchBar`, not `searchBar`).
- **Model persistence**: `stock_rf_model.pkl` written to CWD via pickle. Copies end up in both `backend/` and `analysis/` depending on where Python runs.

## KEY ANTI-PATTERNS & RISKS
- **Hard-coded port**: `App.jsx` line 22 uses `http://localhost:3001` — no env var, no proxy config.
- **Python unbuffered flag missing**: `backend/server.js` calls `execFile('python', [...])` without `-u` flag — can hang on large output.
- **Model retrained per call**: `auto_predict=true` trains fresh RF model every request — expensive, non-deterministic, race condition if two calls write `.pkl` simultaneously.
- **In-memory cache only**: 5-min TTL, single-process, lost on restart. No Redis or shared cache.
- **IB env vars required**: `.env` file must exist with `IB_HOST`, `IB_PORT`, `IB_CLIENT_ID`, timeout params — app crashes without them.
- **No input sanitization**: Symbol, date_range, interval passed directly to Python CLI — potential injection risk.
- **No test suite**: No test framework, no automated tests, no CI/CD.
- **backend/package.json "main"**: Points to `index.js` but actual entry is `server.js` — misleading.
- **No requirements.txt**: README references it but file doesn't exist — manual pip install required.

## CHROME DEVTOOLS MCP TESTING
When testing UI features or debugging:
1. **Navigate**: `chrome-devtools_new_page` or `chrome-devtools_navigate_page` to `http://localhost:5173`.
2. **Inspect**: `chrome-devtools_take_snapshot` to get accessibility tree with `uid`s (prefer over screenshots).
3. **Interact**: Use `chrome-devtools_click`, `chrome-devtools_fill`, `chrome-devtools_type_text` with snapshot `uid`s.
4. **Assert**: `chrome-devtools_wait_for` for text, or `chrome-devtools_evaluate_script` for DOM state.
5. **Debug**: `chrome-devtools_list_console_messages` for errors; `chrome-devtools_list_network_requests` for API calls.
6. **Profile**: `chrome-devtools_performance_start_trace` → user actions → `chrome-devtools_performance_stop_trace` for perf analysis.
7. **Cleanup**: `chrome-devtools_close_page` when done.

## TECHNICAL DETAILS
- **RF model**: `n_estimators=100, max_depth=10, min_samples_split=20, min_samples_leaf=10, class_weight='balanced'`, random_state=42. BUY label: future_return > 1%.
- **16 indicators**: SMA(5,10,20,50), EMA(12,26), RSI(14), MACD + signal + histogram, Bollinger Bands (upper/mid/lower), ATR(14), OBV, Stochastic %K.
- **Cache key**: `${symbol}-${date_range}-${interval}-${auto_predict}`.
- **execFile buffer**: 10MB maxBuffer for Python stdout.
- **IB order queueing**: Sequential promise chain to prevent race conditions on nextOrderId requests.
- **Portfolio sync**: Waits for `positionEnd` event from IB Gateway, 5-10s timeout.
- **CORS**: `cors()` allows all origins — no restrictions.
- **ESLint**: Flat config in `frontend/eslint.config.js`. `no-unused-vars` ignores `^[A-Z_]` pattern.
