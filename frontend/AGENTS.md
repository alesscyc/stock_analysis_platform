# Frontend

React 19/Vite 7 single-page UI using lightweight-charts. There is no router; src/App.jsx owns the main application state and coordinates panels.

## Where to work

- src/App.jsx: application state, data loading, and panel orchestration
- src/chartLoading.js: chart-history window and merge helpers
- src/environment.js: browser, GitHub Pages, and Electron environment checks
- src/i18n/: translations and language context
- src/index.css: global reset and design tokens
- component/: React components, chart helpers, component CSS, and nearby tests

Components belong in frontend/component/, not under src/.

## Conventions

- Use JavaScript/JSX and ESM.
- Components use default exports; utility modules may use named exports.
- Keep component-specific CSS and tests beside the component. Reuse tokens from src/index.css.
- Route user-facing text through src/i18n/; update both English and Traditional Chinese strings.
- Use relative /api/... requests. The Vite proxy handles local routing, while the built app uses the same origin. Never hard-code the backend host.
- Preserve abort/cleanup behavior for fetches, event listeners, observers, and lightweight-charts objects.
- Keep persistent browser state namespaced and validate stored data before use.
- Maintain keyboard navigation, focus handling, labels, and other existing accessibility behavior.

## Checks

From the repository root:

    npm --prefix frontend test
    npm --prefix frontend run lint
    npm --prefix frontend run build

Add the smallest focused Vitest test for changed behavior. The production build may emit the existing large-chunk warning; a warning alone is not a failure.
