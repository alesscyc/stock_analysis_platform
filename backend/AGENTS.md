# BACKEND — Express 5.1 API Bridge

## OVERVIEW
Express API with IB Gateway integration: receives stock symbol requests, shells out to Python analysis, caches and returns JSON. Also manages real trading via Interactive Brokers.

## STRUCTURE
```
backend/
├── server.js             # 476 lines — routes + IB connection + Python proxy
├── .env                  # ⚠ Required: IB_HOST, IB_PORT, IB_CLIENT_ID, timeouts
├── package.json          # ⚠ "main" says index.js but entry is server.js
└── stock_rf_model.pkl    # ML model artifact (written by Python to CWD)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CORS + cache setup | `server.js:1-50` | Cache TTL 5 min, allowed order actions/TIF |
| IB connection mgmt | `server.js:51-150` | Connect, reconnect logic, portfolio/orders state |
| Stock data route | `server.js` | `GET /api/stock/:symbol?date_range&interval&auto_predict` |
| Order placement | `server.js` | `POST /api/orders` with validation & IB queue |
| Portfolio fetch | `server.js` | `GET /api/portfolio` returns cached positions |
| Pending orders | `server.js` | `GET /api/orders/pending` returns open orders |
| Python execution | `server.js` | `execFile('python', [...])` with 10MB buffer |

## CONVENTIONS
- **CJS**: Uses `require()`. No `"type"` field in package.json (defaults to CJS).
- **Express 5.1**: Async error handling built-in (no need for express-async-errors).
- **Python bridge**: `execFile('python', ['analysis/stock_data.py', fn, symbol, ...])`. Expects pure JSON on stdout.
- **Cache key**: `${symbol}-${date_range}-${interval}-${auto_predict}`.
- **IB connection**: Initialized on startup, reconnects on disconnect. Portfolio synced before responding to requests.

## KEY ANTI-PATTERNS & RISKS
- **Missing `-u` flag**: Python called without unbuffered flag — can hang on large output.
- **package.json "main"**: Says `index.js` but actual entry is `server.js` — misleading.
- **In-memory cache**: Single-process, no eviction strategy, lost on restart. No Redis/external store.
- **No input validation**: Symbol, date_range, interval passed directly to Python CLI — no sanitization.
- **maxBuffer 10MB**: Large but finite — very long histories could exceed.
- **Race condition on .pkl**: Multiple simultaneous requests with `auto_predict=true` can write model file concurrently.
- **IB env vars required**: `.env` must have `IB_HOST`, `IB_PORT`, `IB_CLIENT_ID`, `IB_PORTFOLIO_SYNC_TIMEOUT_MS`, `IB_ORDER_ID_WAIT_TIMEOUT_MS` — app crashes without them.
- **Order queueing**: Sequential promise chain prevents race conditions on `nextOrderId`. High concurrency may deadlock if IB Gateway is slow.
- **Portfolio sync timeout**: 5-10 second wait for IB Gateway `positionEnd` event. Can block API responses if IB is laggy.

## COMMANDS
```bash
node server.js       # Start on port 3001
npm run dev          # nodemon server.js (auto-restart on changes)
```

## TECHNICAL DETAILS
- **cache TTL**: 5 minutes (300s)
- **execFile maxBuffer**: 10 MB for Python stdout
- **IB order queueing**: Sequential promise chain via `orderPlacementQueue`
- **Portfolio waiter timeout**: `IB_PORTFOLIO_SYNC_TIMEOUT_MS` from `.env`
- **Order ID wait timeout**: `IB_ORDER_ID_WAIT_TIMEOUT_MS` from `.env`
- **Allowed order actions**: `['BUY', 'SELL']`
- **Allowed time in force**: `['DAY', 'GTC', 'IOC', 'FOK']`
