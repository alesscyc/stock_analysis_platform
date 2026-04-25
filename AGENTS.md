# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-25  
**Branch:** main

## OVERVIEW
Full-stack stock analysis platform: React/Vite frontend (lightweight-charts) → Express API with Finnhub symbol search + IB Gateway bridge → Python ML engine (yfinance + scikit-learn RandomForest). Single-page UI, real trading via Interactive Brokers, no auth, no routing.

## STRUCTURE
```
stock_analysis_platform/
├── frontend/               # Vite 7 + React 19, ESM, lightweight-charts v5.1
│   ├── component/          # ⚠ Components live HERE (not src/component/)
│   │   ├── StockChart.jsx      # 354 lines — candlestick, MA overlays, AI panel
│   │   ├── StockChart.css
│   │   ├── SearchBar.jsx       # Debounced Finnhub autocomplete + keyboard nav
│   │   ├── searchBar.css       # ⚠ lowercase filename
│   │   ├── TradeDialog.jsx     # BUY/SELL order ticket sidebar
│   │   ├── TradeDialog.css
│   │   ├── PortfolioDialog.jsx # IB portfolio sidebar
│   │   ├── PortfolioDialog.css
│   │   ├── OrdersDialog.jsx    # IB pending orders sidebar
│   │   └── OrdersDialog.css
│   ├── src/
│   │   ├── main.jsx        # Entry: StrictMode + createRoot
│   │   ├── App.jsx         # 177 lines — topbar + instrument header + workspace
│   │   ├── App.css         # Topbar, instrument header, empty state layout
│   │   ├── index.css       # Design tokens (CSS vars) + global resets
│   │   └── component/      # ⚠ Empty — do NOT put components here
│   └── dist/               # Built output (gitignored)
├── backend/                # Express 5.1, CJS (require), 625 lines
│   ├── server.js           # API routes + Finnhub proxy + IB Gateway bridge + Python proxy
│   └── .env                # ⚠ Required: IB_HOST, IB_PORT, IB_CLIENT_ID, FINNHUB_KEY, timeouts
└── analysis/               # Python ML engine, 473 lines
    ├── stock_data.py       # Fetch + 5 MAs + 16 RF features + training + CLI
    └── stock_rf_model.pkl  # Trained model artifact (written to CWD)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Chart widget + MA toggles | `frontend/component/StockChart.jsx` | lightweight-charts candlestick, volume bars, 5 MA overlays (200/150/50/20/10) |
| Search + autocomplete | `frontend/component/SearchBar.jsx` | Debounced Finnhub symbol search, keyboard nav (↑↓/Enter/Escape) |
| App layout + state root | `frontend/src/App.jsx` | Topbar, instrument header, workspace; orchestrates all state |
| Stock data API route | `backend/server.js` | `GET /api/stock/:symbol?date_range&interval&auto_predict` |
| Symbol search API route | `backend/server.js` | `GET /api/symbols?q=` — proxies Finnhub search, returns `[{symbol, description}]` |
| Trading routes | `backend/server.js` | `POST /api/orders`, `GET /api/portfolio`, `GET /api/orders/pending` |
| IB Gateway bridge | `backend/server.js` | Connection mgmt, event handlers, order queueing, portfolio caching |
| Python CLI dispatch | `analysis/stock_data.py` | `get_stock_price_history`, `get_current_stock_price` (only these two are CLI-accessible) |
| RF training (internal) | `analysis/stock_data.py` | `train_random_forest_model(stock_data)` — called internally when `auto_predict=true` |
| RF prediction (internal) | `analysis/stock_data.py` | `predict_stock_recommendation(stock_data, model_file)` — called internally after training |

## DATA FLOW
```
SearchBar (typing) → debounced 300ms → GET /api/symbols?q=<term>
  → backend proxies Finnhub search API → returns [{symbol, description}]
  → dropdown autocomplete; Enter/click selects

SearchBar (Enter/select) → App.jsx fetchStockData → GET /api/stock/:symbol?date_range=max&interval=1d&auto_predict=true
  → backend shells Python: execFile('python', ['analysis/stock_data.py', 'get_stock_price_history', ...])
  → Python outputs JSON (OHLCV + 5 MAs + 16 ML features + prediction appended) to stdout
  → backend caches (5 min TTL) and returns to frontend
  → StockChart renders candlesticks, MAs, volume
  → App.jsx instruments header shows symbol, price, interval, AI signal
  → StockChart controls bar shows AI recommendation badge

BUY/SELL button (TradeDialog) → POST /api/orders
  → backend validates, queues order to IB Gateway
  → IB Gateway executes real trade, updates portfolio cache

UI portfolio/orders queries → GET /api/portfolio or /api/orders/pending
  → Express returns IB Gateway cached snapshot
```

## SETUP & COMMANDS
```bash
# Install all dependencies
cd frontend && npm install
cd ../backend && npm install
cd ../analysis && pip install yfinance pandas numpy scikit-learn requests

# Configure backend (required)
# backend/.env must have:
#   IB_HOST, IB_PORT, IB_CLIENT_ID
#   IB_PORTFOLIO_SYNC_TIMEOUT_MS, IB_ORDER_ID_WAIT_TIMEOUT_MS
#   FINNHUB_KEY  (optional — symbol search degrades gracefully without it)

# Run (3 terminals)
cd frontend && npm run dev                    # Dev server on port 5173 (Vite 7)
cd backend && npm run dev                     # API on port 3001 (nodemon auto-restart)

# Direct Python CLI (for testing analysis — only these two are CLI-accessible)
python analysis/stock_data.py get_stock_price_history AAPL max 1d true
python analysis/stock_data.py get_current_stock_price AAPL
```

## CONVENTIONS
- **Frontend**: ESM (`"type": "module"`), default exports only, imports from `../component/` (relative, up one from `src/`).
- **Backend**: CJS (`require()`), no routes dir, all logic in `server.js`.
- **Python**: Must output **pure JSON** to stdout. No `print()` for debugging — breaks `execFile` parser. Use `sys.stderr` for errors.
- **Charting**: lightweight-charts v5.1.0. Import: `createChart`, `CandlestickSeries`, `HistogramSeries`, `LineSeries`, `CrosshairMode`, `LineStyle`.
- **MA overlays**: 5 lines — 200MA (#e0e0e0), 150MA (#f0e040), 50MA (#4488ff), 20MA (#00e5c8), 10MA (#ff5555).
- **Case-sensitive imports**: Component filenames are PascalCase **except** `searchBar.css` (lowercase `s`).
- **Component CSS**: Every component now has its own CSS file (no inline styles). CSS uses design tokens from `index.css`.
- **Design tokens**: All colors/spacing/radius/shadow defined as CSS custom properties in `src/index.css`.
- **Model persistence**: `stock_rf_model.pkl` written to CWD via pickle. Ends up in `backend/` when called via Express.

## KEY ANTI-PATTERNS & RISKS
- **Hard-coded port**: `App.jsx`, `SearchBar.jsx`, `TradeDialog.jsx`, `PortfolioDialog.jsx`, `OrdersDialog.jsx` all use `http://localhost:3001` — no env var, no proxy config.
- **Python unbuffered flag missing**: `execFile('python', [...])` without `-u` flag — can hang on large output.
- **Model retrained per call**: `auto_predict=true` trains fresh RF model every request — expensive, non-deterministic, race condition if two calls write `.pkl` simultaneously.
- **In-memory cache only**: 5-min TTL, single-process, lost on restart. Shared for both stock data and symbol search results.
- **IB env vars required**: `.env` must exist with all IB vars — app crashes without them.
- **FINNHUB_KEY optional**: Symbol search returns empty array if key missing or set to `'placeholder'`.
- **No input sanitization**: Symbol, date_range, interval passed directly to Python CLI — potential injection risk.
- **No test suite**: No test framework, no automated tests, no CI/CD.
- **backend/package.json "main"**: Points to `index.js` but actual entry is `server.js` — misleading.
- **No requirements.txt**: Install manually: `pip install yfinance pandas numpy scikit-learn requests`.
- **train/predict not CLI commands**: `train_random_forest_model` and `predict_stock_recommendation` are internal functions only — NOT dispatched via `__main__`.
- **`src/component/` is empty**: Components live in `frontend/component/`, NOT `frontend/src/component/`.

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
- **RF model**: `n_estimators=100, max_depth=10, min_samples_split=20, min_samples_leaf=10, class_weight='balanced'`, `random_state=42`. BUY label: `future_return > 1%` (22-day forward return).
- **16 RF features**: `MA50_above_MA150`, `MA150_above_MA200`, `Price_above_MA50`, `Volume_20MA_uptrend`, `MA200_uptrend_past_month`, `MA200_uptrend_past_6months`, `MA200_uptrend_past_year`, `Price_above_52week_low_30pct`, `Price_within_25pct_of_52week_high`, `Week_Price_Range`, `Month_Price_Range`, `Price_Change_1D`, `Price_Change_1W`, `Price_Change_1M`, `Price_Change_3M`, `Price_more_rise_than_fall_month`.
- **Features only computed for `interval=1d`**: All 16 ML features and the Label field are `None` for weekly/monthly intervals.
- **Cache key**: `${symbol}-${date_range}-${interval}-${auto_predict}` (stock data) and `symbols-${query}` (symbol search).
- **execFile buffer**: 50MB maxBuffer for Python stdout (`1024*1024*50`).
- **IB order queueing**: Sequential promise chain (`orderPlacementQueue`) to prevent race conditions on nextOrderId requests.
- **Portfolio sync**: Waits for `positionEnd` event from IB Gateway; timeout from `IB_PORTFOLIO_SYNC_TIMEOUT_MS`.
- **CORS**: `cors()` allows all origins — no restrictions.
- **ESLint**: Flat config in `frontend/eslint.config.js`. `no-unused-vars` ignores `^[A-Z_]` pattern.
- **Vite**: v7.0.4 (frontend devDependency).
- **Finnhub symbol search**: Query trimmed to 50 chars max, results capped at 10, cached with same 5-min TTL.
