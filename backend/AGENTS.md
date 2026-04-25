# BACKEND — Express 5.1 API Bridge

## OVERVIEW
Express API with Finnhub symbol search proxy, IB Gateway integration, and Python analysis bridge. Receives stock symbol requests, shells out to Python for OHLCV + ML data, caches results, and manages real trading via Interactive Brokers.

## STRUCTURE
```
backend/
├── server.js             # 625 lines — all routes + IB connection + Python proxy + Finnhub proxy
├── .env                  # ⚠ Required: IB_HOST, IB_PORT, IB_CLIENT_ID, FINNHUB_KEY, timeouts
├── package.json          # ⚠ "main" says index.js but actual entry is server.js
└── stock_rf_model.pkl    # ML model artifact (written by Python to CWD = backend/)
```

## API ROUTES
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/stock/:symbol` | Fetch OHLCV + MAs + ML features via Python. Query: `date_range`, `interval`, `auto_predict` |
| `GET` | `/api/symbols` | Finnhub symbol search proxy. Query: `q`. Returns `[{symbol, description}]` |
| `POST` | `/api/orders` | Place limit order via IB Gateway. Body: `symbol`, `action`, `quantity`, `price`, `tif` |
| `GET` | `/api/portfolio` | Fetch IB portfolio positions (waits for snapshot) |
| `GET` | `/api/orders/pending` | Fetch IB open orders snapshot |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Cache + constants setup | `server.js:1-50` | Cache TTL 5 min, allowed order actions/TIF, env var reads |
| IB connection mgmt | `server.js:50-250` | Connect, reconnect logic, portfolio/orders state, waiters pattern |
| Stock data route | `server.js` | `GET /api/stock/:symbol` — shells Python, 50MB buffer, 5min cache |
| Symbol search route | `server.js` | `GET /api/symbols` — Finnhub proxy, 10 results max, 5min cache |
| Order placement | `server.js` | `POST /api/orders` with validation, IB queue, order ID wait |
| Portfolio fetch | `server.js` | `GET /api/portfolio` — waits for IB `positionEnd` event |
| Pending orders | `server.js` | `GET /api/orders/pending` — returns `openOrdersById` snapshot |
| Python execution | `server.js` | `execFile('python', [...])` with 50MB buffer (`1024*1024*50`) |

## CONVENTIONS
- **CJS**: Uses `require()`. No `"type"` field in package.json (defaults to CJS).
- **Express 5.1**: Async error handling built-in.
- **Python bridge**: `execFile('python', ['analysis/stock_data.py', fn, symbol, ...])`. Expects pure JSON on stdout.
- **Cache key (stock data)**: `${symbol}-${date_range}-${interval}-${auto_predict}`.
- **Cache key (symbols)**: `symbols-${query}`.
- **IB connection**: Initialized on startup (`connectIbGateway()`), reconnects on disconnect with exponential backoff (max 30s).
- **Finnhub key**: Read from `FINNHUB_KEY` env var. Returns `[]` if missing or `'placeholder'`.

## KEY ANTI-PATTERNS & RISKS
- **Missing `-u` flag**: Python called without unbuffered flag — can hang on large output.
- **package.json "main"**: Says `index.js` but actual entry is `server.js` — misleading.
- **In-memory cache**: Single-process, no eviction strategy, lost on restart. No Redis/external store.
- **No input sanitization**: Symbol, date_range, interval passed directly to Python CLI — potential injection risk.
- **maxBuffer 50MB**: Large but still finite — very long histories could theoretically exceed.
- **Race condition on .pkl**: Multiple simultaneous requests with `auto_predict=true` can write model file concurrently.
- **IB env vars required**: `.env` must have `IB_HOST`, `IB_PORT`, `IB_CLIENT_ID`, `IB_PORTFOLIO_SYNC_TIMEOUT_MS`, `IB_ORDER_ID_WAIT_TIMEOUT_MS` — app crashes without them.
- **Order queueing**: Sequential promise chain (`orderPlacementQueue`) prevents race conditions on `nextOrderId`. High concurrency may deadlock if IB Gateway is slow.
- **Portfolio sync timeout**: Waits for IB Gateway `positionEnd` event; can block `GET /api/portfolio` responses if IB is laggy.
- **nodemon not in devDependencies**: `npm run dev` uses nodemon but it's not listed — requires global install.

## COMMANDS
```bash
node server.js       # Start on port 3001
npm run dev          # nodemon server.js (auto-restart on changes)
```

## TECHNICAL DETAILS
- **Cache TTL**: 5 minutes (300,000ms)
- **execFile maxBuffer**: 50MB (`1024 * 1024 * 50`)
- **IB order queueing**: Sequential promise chain via `orderPlacementQueue`
- **Portfolio waiter timeout**: `IB_PORTFOLIO_SYNC_TIMEOUT_MS` from `.env`
- **Order ID wait timeout**: `IB_ORDER_ID_WAIT_TIMEOUT_MS` from `.env`
- **Allowed order actions**: `['BUY', 'SELL']`
- **Allowed time in force**: `['DAY', 'GTC', 'IOC', 'FOK']`
- **Finnhub results cap**: 10 symbols per query
- **Finnhub query length cap**: 50 characters
- **Reconnect backoff**: `Math.min(30000, 1000 * reconnectAttempts)` ms
- **IB orders cleanup**: Orders removed from tracking when status is `Filled`, `Cancelled`, `ApiCancelled`, `Rejected`, or `Inactive`
