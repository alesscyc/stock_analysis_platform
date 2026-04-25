# FRONTEND — Vite + React 19

## OVERVIEW
Single-page stock analysis UI. No routing, no auth. State lives in `App.jsx`, passed down as props.

## STRUCTURE
```
frontend/
├── src/
│   ├── main.jsx          # Entry: StrictMode + createRoot
│   ├── App.jsx           # Root: SearchBar + StockChart, fetch logic
│   ├── App.css           # Layout: flex column, 100vh
│   └── index.css         # Global: system-ui font, light/dark scheme
├── component/            # ⚠ Components live HERE, not in src/
│   ├── StockChart.jsx    # 354 lines — lightweight-charts candlestick, MA overlays, zoom, AI prediction panel
│   ├── SearchBar.jsx     # Input + Enter-to-search ticker lookup
│   ├── TradeDialog.jsx   # Price/amount sidebar, BUY button
│   ├── PortfolioDialog.jsx   # Read-only IB portfolio display
│   ├── OrdersDialog.jsx      # Read-only IB pending orders display
│   └── StockChart.css    # Chart styling
├── vite.config.js        # Minimal: plugins: [react()]
├── eslint.config.js      # Flat config, react-hooks + react-refresh
└── dist/                 # Built output (gitignored)
```

## CONVENTIONS
- **ESM**: `"type": "module"` in package.json. All imports use ESM syntax.
- **Default exports only**: Every component file exports default.
- **No TypeScript**: All `.jsx` / `.js`.
- **Inline styles**: StockChart, TradeDialog use inline styles. Minimal CSS files.
- **Import paths**: `App.jsx` imports from `../component/` (relative, up one level from `src/`).
- **ESLint**: Flat config in `eslint.config.js`. `no-unused-vars` ignores `^[A-Z_]` pattern.

## KEY ANTI-PATTERNS
- **Do NOT put components in `src/component/`** — that dir is empty. Components live in `frontend/component/`.
- **Do NOT use lowercase** for component file imports (`searchBar` ≠ `SearchBar`).
- **Hard-coded API URL**: `App.jsx` line 22 fetches `http://localhost:3001/...` — no env var, no proxy.

## DEPENDENCIES
- **lightweight-charts** (v5.1.0) — candlestick charting, replaces Chart.js for better perf.
- **react** (19.1.0), **react-dom** (19.1.0).

## COMMANDS
```bash
npm run dev      # Vite dev server on port 5173
npm run build    # Production build → dist/
npm run lint     # ESLint check
```
