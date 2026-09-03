# Backend

CommonJS Express API that proxies analysis requests, manages the Python service, and bridges Interactive Brokers.

## Where to work

- server.js: routes, caching, IB lifecycle, order handling, and Python process supervision
- chatSafety.js: sanitization of account context and AI-generated order drafts
- settingsEnv.js: desktop settings validation and atomic .env updates
- test/: Node test-runner coverage

See the root README.md for the public API and .env.example for supported configuration.

## Runtime

- The server listens on port 3001 and starts analysis/stock_data.py serve on port 8000.
- Analysis routes call the persistent FastAPI service over HTTP. Do not spawn Python once per request.
- Browser development uses permissive CORS. Desktop mode binds to loopback, serves frontend/dist, and disables that CORS path.
- Market-data caches are process-local and disappear on restart.
- Finnhub, IB, and AI chat degrade or fail independently when their configuration is absent.

## Invariants

- Validate and normalize all request data before sending it to Python, IB, the filesystem, or an external API.
- Keep IB order placement serialized. Preserve stable order references and parent/child bracket relationships when modifying or cancelling orders.
- AI output may produce a validated draft for user review; it must never place an order directly. Keep account context restricted by chatSafety.js.
- Desktop settings routes must remain unavailable outside desktop mode. Never return stored secret values.
- Keep settings writes allowlisted, validated, atomic, and private.
- Preserve graceful shutdown of the Python child and IB connection.
- Return useful JSON errors without leaking credentials or upstream response bodies.

## Checks

From the repository root:

    npm --prefix backend test

Add focused tests under backend/test/ for route helpers, validation, settings, chat safety, and trading behavior. Do not require live IB, Finnhub, AI, or Yahoo services in unit tests.
