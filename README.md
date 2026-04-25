# 🚀 Stock Analysis Platform (updated)

This repository is a lightweight full‑stack stock analysis platform: a React/Vite frontend that renders candlestick charts and UI, an Express backend that proxies symbol search and dispatches Python analysis, and a small Python ML engine for per‑symbol predictions.

Badges: Active • Python 3.8+ • React (ESM) • Node.js

Overview
 - Frontend: React + Vite, lightweight-charts for candlesticks and overlays
 - Backend: Express (CJS) — API routes, Finnhub proxy, Interactive Brokers (IB) Gateway bridge, Python CLI bridge
 - Analysis: Python scripts that fetch OHLCV, compute moving averages & features, and train/predict with a RandomForest

Repository layout
```
stock_analysis_platform/
├── frontend/               # Vite + React frontend (components under frontend/component)
├── backend/                # Express server (server.js) — CJS
└── analysis/               # Python ML engine (stock_data.py)
```

Where to look quickly
- Chart widget & MA overlays: frontend/component/StockChart.jsx
- Search & autocomplete: frontend/component/SearchBar.jsx
- App root & orchestration: frontend/src/App.jsx
- API + IB bridge + Python proxy: backend/server.js
- Python analysis (CLI entrypoints & features): analysis/stock_data.py

Quick start (development)
Prerequisites: Node.js (>=16), npm, Python (>=3.8), pip

1) Install frontend deps
   cd frontend && npm install

2) Install backend deps
   cd ../backend && npm install

3) Install Python deps (no requirements.txt in repo)
   cd ../analysis
   pip install yfinance pandas numpy scikit-learn requests

Configuration
- backend/.env (required for IB gateway integration):
  IB_HOST, IB_PORT, IB_CLIENT_ID
  IB_PORTFOLIO_SYNC_TIMEOUT_MS, IB_ORDER_ID_WAIT_TIMEOUT_MS
  FINNHUB_KEY (optional — symbol search degrades if absent)

Running the app (three terminals recommended)
- Frontend dev server (Vite, port 5173):
  cd frontend && npm run dev
- Backend API (nodemon in dev):
  cd backend && npm run dev    # serves on http://localhost:3001
- (Optional) Start IB Gateway / services required by backend

Notes: many frontend files call the backend at http://localhost:3001 (hard-coded). The Vite dev server runs on 5173 by default.

API highlights
- Symbol search (proxies Finnhub):
  GET /api/symbols?q=<term>
  Returns: [{symbol, description}] (cached 5min)
- Stock data + optional ML prediction:
  GET /api/stock/:symbol?date_range=<>&interval=<>&auto_predict=<true|false>
  The backend shells the Python CLI (analysis/stock_data.py get_stock_price_history ...) and returns the JSON produced by Python (cached 5min).
- Trading endpoints (bridge to IB): POST /api/orders, GET /api/portfolio, GET /api/orders/pending

Python CLI notes
- Exposed CLI commands (used by backend):
  python analysis/stock_data.py get_stock_price_history AAPL max 1d true
  python analysis/stock_data.py get_current_stock_price AAPL
- Important: the Python script MUST output pure JSON to stdout. Use sys.stderr for debug; stdout is parsed by the backend.

Machine learning summary
- Model: RandomForestClassifier (n_estimators=100, max_depth=10, class_weight='balanced', random_state=42)
- Features: 16 technical features (MA relationships, volume trends, long-term MA trends, price vs 52-week high/low, momentum windows, volatility measures)
- Label: BUY when 22-day forward return > 1%
- NOTE: auto_predict=true triggers training a fresh model per request (expensive and non-deterministic).

Project conventions & gotchas (important)
- Components live in frontend/component/ (NOT frontend/src/component/) — this repo uses case-sensitive filenames; one CSS file intentionally lowercased: searchBar.css
- Charting: lightweight-charts v5.1.0; MA line colors are defined in StockChart.jsx and design tokens are in frontend/src/index.css
- Backend: CommonJS (require) — server entry is server.js
- Python: do not print non-JSON to stdout. The backend uses execFile with a 50MB stdout buffer; missing the -u flag when launching Python can cause buffering/hangs.
- Caching: simple in-memory cache with 5-minute TTL (single-process). Cache keys: `${symbol}-${date_range}-${interval}-${auto_predict}` and `symbols-${query}`
- Security & stability warnings:
  - No authentication in API (development/demo only).
  - Input values (symbol, date_range, interval) are passed directly to the Python CLI — potential injection risk.
  - auto_predict retrains per request and writes stock_rf_model.pkl to CWD (race conditions possible if concurrent requests occur).
  - backend/.env is required for IB features; missing values may crash the server.

Testing & debugging tips
- To reproduce the backend → Python flow locally, run the Python CLI example above and confirm it outputs valid JSON.
- Use browser devtools to inspect network calls to http://localhost:3001 when exercising the UI.

Contributions
- This repo has no test suite or CI configured. When making changes, follow the project's style (surgical changes only) and run the frontend and backend locally to verify behavior.

Acknowledgements
- Yahoo Finance (yfinance) for OHLCV data
- Finnhub / Polygon for symbol search capabilities (proxied)
- lightweight-charts and React ecosystem for the UI

If you'd like, I can:
- update the frontend to read backend URL from an env var (remove hard-coded http://localhost:3001)
- change the backend to launch Python with -u to avoid buffering issues
- stop retraining the model per request and instead reuse a cached model artifact
Tell me which of the above you'd like implemented and I will make a surgical change and verify it locally.
