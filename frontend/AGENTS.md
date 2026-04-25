# FRONTEND — Vite 7 + React 19

## OVERVIEW
Single-page stock analysis UI. No routing, no auth. State lives in `App.jsx`, passed down as props.

## STRUCTURE
```
frontend/
├── src/
│   ├── main.jsx              # Entry: StrictMode + createRoot
│   ├── App.jsx               # 177 lines — topbar + instrument header + workspace + state root
│   ├── App.css               # Topbar, instrument header, empty state, chart wrapper layout
│   ├── index.css             # Design tokens (CSS custom properties) + global resets
│   └── component/            # ⚠ Empty — do NOT put components here
├── component/                # ⚠ Components live HERE, not in src/
│   ├── StockChart.jsx        # 354 lines — lightweight-charts candlestick, MA overlays, AI badge
│   ├── StockChart.css
│   ├── SearchBar.jsx         # 183 lines — debounced Finnhub autocomplete + keyboard nav
│   ├── searchBar.css         # ⚠ lowercase 's'
│   ├── TradeDialog.jsx       # 223 lines — BUY/SELL order ticket sidebar
│   ├── TradeDialog.css
│   ├── PortfolioDialog.jsx   # 162 lines — read-only IB portfolio sidebar
│   ├── PortfolioDialog.css
│   ├── OrdersDialog.jsx      # 165 lines — read-only IB pending orders sidebar
│   └── OrdersDialog.css
├── vite.config.js            # Minimal: plugins: [react()]
├── eslint.config.js          # Flat config, react-hooks + react-refresh
└── dist/                     # Built output (gitignored)
```

## APP LAYOUT (App.jsx)
- **Topbar** (`app-topbar`): Brand icon ("S" / StockAI), divider, SearchBar, Portfolio + Orders buttons.
- **Instrument header** (`instrument-header`): Shown once a stock is loaded. Displays symbol, latest close price, interval, AI signal + confidence, data point count.
- **Workspace** (`app-workspace`): Empty state (no stock selected) → loading state → chart container when data present.
- **Sidebars**: `PortfolioDialog` and `OrdersDialog` rendered at root level (outside workspace), toggled by topbar buttons.

## CONVENTIONS
- **ESM**: `"type": "module"` in package.json. All imports use ESM syntax.
- **Default exports only**: Every component file exports default.
- **No TypeScript**: All `.jsx` / `.js`.
- **CSS files**: Every component has a dedicated `.css` file — no inline styles. CSS consumes design tokens from `src/index.css`.
- **Import paths**: `App.jsx` imports from `../component/` (relative, up one level from `src/`).
- **Design tokens**: All colors, spacing, radius, shadows defined as CSS vars in `src/index.css`.
- **Case-sensitive imports**: All component filenames are PascalCase **except** `searchBar.css` (lowercase `s`).
- **ESLint**: Flat config in `eslint.config.js`. `no-unused-vars` ignores `^[A-Z_]` pattern.

## KEY COMPONENT DETAILS
- **SearchBar**: Debounces user input 300ms, fetches `GET /api/symbols?q=` for autocomplete. Keyboard nav: ↑↓ to highlight, Enter to select/submit, Escape to close. Clears input on selection.
- **StockChart**: Creates lightweight-charts instance on mount. ResizeObserver keeps chart fitted. 5 MA toggles (checkboxes). AI recommendation badge rendered in controls bar.
- **TradeDialog**: Validates price/quantity before submitting `POST /api/orders`. Shows estimated total, inline success/error feedback.
- **PortfolioDialog**: Fetches `GET /api/portfolio` on open with AbortController cleanup. Shows positions table + cost basis summary.
- **OrdersDialog**: Fetches `GET /api/orders/pending` on open. Shows order table with status badges.

## KEY ANTI-PATTERNS
- **Do NOT put components in `src/component/`** — that dir is empty. Components live in `frontend/component/`.
- **Do NOT use lowercase** for component file imports — `searchBar.css` is the only exception and it's imported by filename only.
- **Hard-coded API URL**: All components fetch `http://localhost:3001/...` — no env var, no Vite proxy config.

## DEPENDENCIES
| Package | Version | Purpose |
|---------|---------|---------|
| `lightweight-charts` | ^5.1.0 | Candlestick charting |
| `react` | ^19.1.0 | UI framework |
| `react-dom` | ^19.1.0 | DOM renderer |
| `vite` | ^7.0.4 | Build tool / dev server |
| `@vitejs/plugin-react` | ^4.6.0 | JSX transform |

## COMMANDS
```bash
npm run dev      # Vite dev server on port 5173
npm run build    # Production build → dist/
npm run lint     # ESLint check
npm run preview  # Preview production build
```
