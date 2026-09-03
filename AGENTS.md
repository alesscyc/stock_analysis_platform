# Stock Analysis Platform

Local stock research and trading app:

- React/Vite frontend
- Express API and Interactive Brokers bridge
- FastAPI/yfinance/scikit-learn analysis service
- Optional Electron desktop shell

There is no authentication. IB order endpoints can place real trades; use a paper account for development.

## Start here

- If `.codegraph/` exists, use `codegraph explore "<question>"` before `rg` or manual file hunting.
- Read the nearest nested `AGENTS.md` before changing a subsystem, but verify volatile details against the code.
- Use `README.md` for setup, API, and packaging documentation. Do not duplicate it here.

## Repository map

| Area | Source of truth |
| --- | --- |
| App state and layout | `frontend/src/App.jsx` |
| React components | `frontend/component/` (not `frontend/src/component/`) |
| Global styles and tokens | `frontend/src/index.css` |
| API, IB integration, Python process management | `backend/server.js` |
| Chat safety | `backend/chatSafety.js` |
| Market data, ML, backtesting, FastAPI, CLI | `analysis/stock_data.py` |
| Windows desktop shell and packaging | `electron/` |

## Development

Run two processes; the backend starts and supervises FastAPI on port 8000.

```bash
npm --prefix backend run dev       # API: http://localhost:3001
npm --prefix frontend run dev      # UI:  http://localhost:5173
```

The frontend calls relative `/api/...` URLs; Vite proxies them to port 3001. Do not start the Python service separately unless debugging it directly.

The backend launches the service with the bare `python` command; it must resolve to Python 3.

Core charting and analysis work without `backend/.env`. Copy `backend/.env.example` when using IB, Finnhub autocomplete, or AI chat. Yahoo Finance access requires network egress.

## Checks

Run the checks for every area you touch:

```bash
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend test
(cd analysis && python -m unittest test_stock_data.py)
npm --prefix electron test
```

## Non-negotiable conventions

- Frontend code is JavaScript/JSX with ESM. Keep components and their CSS in `frontend/component/`.
- Backend code is CommonJS. Keep API paths relative in frontend code.
- Python CLI/service stdout must remain machine-readable JSON. Send diagnostics to stderr.
- Never commit `.env`, API keys, IB credentials, generated models, build output, or dependency directories.
- Preserve order validation and chat safety checks. Treat changes to trading paths as high risk.
- Prefer focused changes. Add or update the smallest relevant test; do not refactor unrelated code.
- Do not add line counts, exhaustive file lists, or copied implementation details to this file; they go stale quickly.
