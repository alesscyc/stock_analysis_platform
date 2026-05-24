# Stock Analysis Platform

A lightweight full‑stack stock analysis platform with real‑time candlestick charts, AI‑powered trade signals, and live Interactive Brokers (IB) Gateway integration for paper or live trading.

**Stack:** React 19 + Vite 7 (frontend) · Express 5 + IB API (backend) · Python + scikit‑learn (ML engine)

---

## Overview

- **Frontend:** React + Vite, lightweight‑charts v5.1 for candlesticks with 5 moving‑average overlays, volume bars, and an AI recommendation panel
- **Backend:** Express (CJS) — REST API, Finnhub symbol‑search proxy, IB Gateway bridge for live trading, Python CLI bridge for OHLCV + ML features
- **Analysis:** Python scripts that fetch OHLCV from Yahoo Finance, compute 5 MAs and 16 technical features, and train/predict with a RandomForest classifier

---

## Repository layout

```
stock_analysis_platform/
├── frontend/
│   ├── component/           # React components (NOT src/component/)
│   │   ├── StockChart.jsx      # Candlestick chart + MA toggles + AI badge
│   │   ├── SearchBar.jsx       # Debounced Finnhub autocomplete
│   │   ├── TradeDialog.jsx     # Order ticket (limit + bracket orders)
│   │   ├── OrdersDialog.jsx    # Pending orders list with cancel
│   │   ├── PortfolioDialog.jsx # IB portfolio positions
│   │   └── *.css               # Component styles (design tokens in src/index.css)
│   └── src/
│       ├── App.jsx             # App root, state orchestration
│       └── index.css           # CSS custom properties (design tokens)
├── backend/
│   ├── server.js             # Express API + IB bridge + Python proxy
│   └── .env                  # Required: IB_HOST, IB_PORT, IB_CLIENT_ID, etc.
└── analysis/
    ├── stock_data.py         # Python ML engine (FastAPI + CLI)
    └── stock_rf_model.pkl    # Trained model artifact (auto‑generated)
```

---

## Quick start (development)

**Prerequisites:** Node.js ≥ 18, npm, Python ≥ 3.9, pip

```bash
# 1. Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173

# 2. Backend
cd ../backend && npm install
# Create backend/.env (see Configuration below)
npm run dev                                   # http://localhost:3001

# 3. Python deps (no requirements.txt)
cd ../analysis
pip install yfinance pandas numpy scikit-learn fastapi "uvicorn[standard]"
```

The backend auto‑starts the Python FastAPI service on port 8000.

---

## Configuration

Create `backend/.env`:

```env
IB_HOST=localhost
IB_PORT=4001
IB_CLIENT_ID=1
IB_PORTFOLIO_SYNC_TIMEOUT_MS=30000
IB_ORDER_ID_WAIT_TIMEOUT_MS=15000
FINNHUB_KEY=your_finnhub_api_key   # optional — symbol search degrades without it
```

**Account selection:** when IB returns multiple accounts, the backend automatically uses the **second** account (`accounts[1]`). If only one account exists, it uses that one.

---

## API highlights

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/symbols?q=<term>` | Finnhub symbol search (cached 5 min) |
| `GET` | `/api/stock/:symbol?date_range=&interval=&auto_predict=` | OHLCV + MAs + 16 ML features + optional AI prediction (cached 5 min) |
| `POST` | `/api/orders` | Place a limit order. Supports bracket orders via `bracket: { takeProfitPrice, stopLossPrice }` |
| `POST` | `/api/orders/:orderId/cancel` | Cancel a pending order via IB |
| `GET` | `/api/portfolio` | Fetch IB portfolio positions |
| `GET` | `/api/orders/pending` | Fetch open orders from IB (synced live) |

---

## Trading features

### Order ticket (`TradeDialog.jsx`)
- **BUY / SELL** limit orders
- **Time in Force:** DAY, GTC, IOC, FOK
- **Bracket orders:** toggle "Bracket exits" to attach:
  - **Take-profit** child order (limit order, opposite action)
  - **Stop-loss** child order (stop order, opposite action)
- Directional validation: e.g. for BUY brackets, take‑profit must be above entry and stop‑loss must be below entry

### Orders sidebar (`OrdersDialog.jsx`)
- Shows **live IB open orders** synced from the gateway (not just locally submitted orders)
- Each pending order has a **cancel** button (×) that calls `POST /api/orders/:orderId/cancel`
- Click a row to load that symbol's chart

### Portfolio sidebar (`PortfolioDialog.jsx`)
- Fetches live IB portfolio positions on open
- Shows symbol, quantity, average cost, and cost basis

---

## Machine learning summary

- **Model:** `RandomForestClassifier` (`n_estimators=100`, `max_depth=10`, `class_weight='balanced'`, `random_state=42`)
- **Features:** 16 technical features (MA relationships, volume trends, long‑term MA trends, price vs 52‑week high/low, momentum windows, volatility measures)
- **Label:** BUY when 22‑day forward return > 1%
- **⚠️ Note:** `auto_predict=true` triggers training a fresh model per request (expensive and non‑deterministic). The model artifact `stock_rf_model.pkl` is written to the current working directory.

---

## Project conventions & gotchas

- **Components live in `frontend/component/`** — NOT `frontend/src/component/`. The `src/component/` directory is intentionally empty.
- **Case‑sensitive imports:** component filenames are PascalCase except `searchBar.css` (lowercase `s`).
- **Charting:** lightweight‑charts v5.1.0. MA line colors: 200MA `#e0e0e0`, 150MA `#f0e040`, 50MA `#4488ff`, 20MA `#00e5c8`, 10MA `#ff5555`.
- **Backend:** CommonJS (`require()`). Entry point is `server.js` (not `index.js` as listed in `package.json`).
- **Python:** MUST output **pure JSON** to stdout. Use `sys.stderr` for debug logs. The backend calls Python via `execFile` with a 50 MB stdout buffer.
- **Caching:** simple in‑memory cache with 5‑minute TTL (single‑process). Cache keys: `${symbol}-${date_range}-${interval}-${auto_predict}` and `symbols-${query}`.
- **Hard‑coded API URL:** frontend components fetch `http://localhost:3001` directly — no env var or proxy config.

---

## Security & stability warnings

- **No authentication** in the API (development / demo only).
- **Input values** (`symbol`, `date_range`, `interval`) are passed directly to the Python CLI — potential injection risk.
- **`auto_predict`** retrains per request and writes `stock_rf_model.pkl` to CWD (race conditions possible with concurrent requests).
- **`backend/.env` is required** for IB features; missing values may crash the server.
- **Orders are sent to a live IB account.** Bracket orders use real money if the account is live. Use **paper trading** for testing.

---

## Testing & debugging tips

- Reproduce the backend → Python flow locally:
  ```bash
  python analysis/stock_data.py get_stock_price_history AAPL max 1d true
  python analysis/stock_data.py get_current_stock_price AAPL
  ```
- Use browser devtools to inspect network calls to `http://localhost:3001`.
- If IB Gateway shows "Unknown IB Gateway error", the client ID may still be in use. Change `IB_CLIENT_ID` in `.env` or restart IB Gateway.

---

## Acknowledgements

- Yahoo Finance (`yfinance`) for OHLCV data
- Finnhub for symbol search capabilities (proxied)
- lightweight‑charts and the React ecosystem for the UI
