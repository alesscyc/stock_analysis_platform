# Stock Analysis Platform

A local full-stack stock research and trading workspace with interactive charts, technical screening, backtesting, AI-assisted signals, and Interactive Brokers integration.

## Features

- Candlestick and volume charts with 10/20/50/150/200-day moving averages
- Price-pattern overlays for double bottoms and double tops
- Persistent per-symbol trend lines, swing zones, trade markers, and IB order lines
- Finnhub symbol search and a browser-local watchlist with live price polling
- Configurable technical screener and strategy backtesting
- Random Forest trade signals with per-symbol model caching
- AI chat over the currently loaded chart data (OpenAI-compatible providers)
- IB portfolio, limit/bracket order placement, modification, and cancellation
- English and Traditional Chinese interface

## Stack

- Frontend: React 19, Vite 7, lightweight-charts 5, Vitest
- Backend: Express 5, Node's test runner, IB API
- Analysis: Python, FastAPI, yfinance, pandas, scikit-learn

## Repository layout

```text
stock_analysis_platform/
|-- frontend/
|   |-- component/          # React components and chart helpers
|   `-- src/                # App shell, i18n, hooks, and global styles
|-- backend/
|   |-- server.js           # REST API, IB bridge, and Python service manager
|   `-- test/               # Backend tests
`-- analysis/
    |-- stock_data.py       # Market data, ML, backtesting, and FastAPI service
    `-- requirements.txt
```

Components live in `frontend/component/`, not `frontend/src/component/`.

## Development setup

Prerequisites: Node.js 18+, npm, Python 3.9+, and optionally IB Gateway or TWS.

```bash
# Install dependencies
cd frontend && npm install
cd ../backend && npm install
cd ../analysis && pip install -r requirements.txt
```

Create `backend/.env`:

```env
IB_HOST=localhost
IB_PORT=4001
IB_CLIENT_ID=1
IB_PORTFOLIO_SYNC_TIMEOUT_MS=30000
IB_ORDER_ID_WAIT_TIMEOUT_MS=15000
IB_OPEN_ORDERS_SYNC_TIMEOUT_MS=15000
FINNHUB_KEY=your_finnhub_api_key
PYTHON_SERVICE_URL=http://127.0.0.1:8000
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=your-model-id
```

`FINNHUB_KEY` is optional; symbol search returns no results without it. `PYTHON_SERVICE_URL` defaults to the value shown above.

AI chat needs `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. Point `OPENAI_BASE_URL` at any OpenAI-compatible provider that exposes `/models` and `/chat/completions` (OpenAI, OpenCode Zen, local gateways, etc.). Without these vars, chat returns `503`.

Run the frontend and backend in separate terminals:

```bash
cd frontend
npm run dev                    # http://localhost:5173

cd backend
npm run dev                    # http://localhost:3001
```

The backend starts the FastAPI analysis service on port 8000 when needed.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/symbols?q=<term>` | Search Finnhub symbols |
| `GET` | `/api/stock/:symbol` | Fetch OHLCV, indicators, and an optional prediction |
| `GET` | `/api/price/:symbol` | Fetch a lightweight current-price snapshot |
| `GET` | `/api/fundamentals/:symbol` | Fetch company fundamentals |
| `GET` | `/api/chat/models` | List available chat models from the configured provider |
| `POST` | `/api/chat` | Ask about the loaded symbol using supplied OHLCV/MA context |
| `GET` | `/api/model/status/:symbol` | Inspect the cached model status |
| `POST` | `/api/model/retrain/:symbol` | Retrain a symbol model |
| `POST` | `/api/backtest` | Run a strategy backtest |
| `GET` | `/api/ib/status` | Check the IB connection |
| `GET` | `/api/portfolio` | Fetch IB positions |
| `GET` | `/api/orders/pending` | Fetch open IB orders |
| `POST` | `/api/orders` | Place a limit or bracket order |
| `PATCH` | `/api/orders/:orderRef` | Modify an open order |
| `POST` | `/api/orders/:orderRef/cancel` | Cancel an open order |

Stock requests accept `date_range`, `interval`, and `auto_predict` query parameters. Market-data and symbol-search responses use a five-minute in-memory cache.

## Tests

```bash
cd frontend
npm test
npm run lint
npm run build

cd ../backend
npm test
```

## Important notes

- The API has no authentication and is intended for local development.
- Orders reach the configured IB account. Use paper trading while testing.
- Set `IB_CLIENT_ID=0` if the app must bind and display manually created TWS/IBKR open orders.
- ML labels use a 22-trading-day forward return above 5%; trained models are cached per symbol for four hours under `analysis/model_cache/`.
- AI chat uses only the chart payload already loaded in the UI (OHLCV, MAs, fundamentals, RF prediction). It does not fetch live news or place trades, and responses are informational only.
- Python service output must remain valid JSON on stdout; write diagnostics to stderr.

## Data sources

- Yahoo Finance through `yfinance` for market data
- Finnhub for symbol search
- OpenAI-compatible chat providers for AI chat
- Interactive Brokers for portfolios and order execution
