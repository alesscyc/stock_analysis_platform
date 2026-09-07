# Browser test report — 2026-09-07

## Fix verification

The three application defects below are now fixed and verified in external Edge:

- Default screening of AAPL, MSFT, and NVDA with all three conditions enabled returns AAPL and NVDA. Daily history supplies 52-week fields without enabling ML prediction.
- AAPL fundamentals display `0.34%` dividend yield.
- Daily → weekly → monthly → daily interval changes load correctly with no captured browser warnings or errors. Markers now detach before chart destruction.

Regression tests failed before the changes and pass afterward. All 80 frontend tests, 12 Python tests, frontend lint, production build, and diff whitespace checks pass. The build retains its existing large-chunk warning.

Chat remains blocked by upstream model availability/free-tier restrictions; no provider credentials, billing choices, or restrictions were changed. IB and browser file-upload limitations also remain external prerequisites.

The original test observations follow for reference.

Tested the running development app at http://localhost:5173 in external Microsoft Edge through the browser extension. No application source changes or trades were made. This is functional smoke coverage, not exhaustive validation of every strategy, data value, or trading path.

## Findings

1. **52-week screener filters reject valid stocks because required fields are missing.** Reproduction: enter `AAPL, MSFT`; enable only “Price above 52-week low”; set the threshold to `0`; run. Result: “No matches.” `frontend/component/ScreenerDialog.jsx:158` requests `auto_predict=false`, but its checks at lines 61–62 require `52week_low` and `52week_high`. `analysis/stock_data.py:281` only emits those fields when auto prediction is enabled for daily data. Moving-average-only screening successfully returned AAPL, NVDA, and SPY. Missing-data reasons are not shown in the result UI.
2. **Dividend yield is multiplied by 100 again.** AAPL fundamentals displayed `34.00%`. A direct read from the installed yfinance returned `dividendYield=0.34`, `dividendRate=1.08`, and `currentPrice=319.97`; the rate/price implies approximately 0.34%. `analysis/stock_data.py:471` passes the yield to `fmt_pct`, which multiplies it by 100.
3. **Chart lifecycle console errors.** During daily/weekly/monthly switching, Edge captured two `Error: Object is disposed` exceptions from lightweight-charts, through `DevicePixelContentBoxBinding2`, `TimeAxisWidget`, and chart resize/draw callbacks. Charts remained visible. The precise lifecycle cause has not been isolated.
4. **Chat provider blocks successful responses.** Model discovery and selection work. `deepseek-v4-flash-free` returned “Model is unavailable.” `mimo-v2.5-free` returned “OpenCode's free tier can only be used in OpenCode.” Errors are displayed in the chat UI; successful generation could not be verified.

## Coverage

| Area | Result |
| --- | --- |
| Home screen and quick ticker selection | Passed: AAPL/MSFT load; NVDA loads from screener. |
| Symbol search | Passed: MSFT autocomplete; typed invalid ticker and Enter display a clear no-data error. |
| Market data and AI signal | Loaded prices, historical bars, and model signals for multiple symbols; predictive accuracy not assessed. |
| Daily/weekly/monthly charts | Data loaded: AAPL 11,525 / 2,387 / 501 bars. Console errors noted above. |
| Fundamentals | Panel toggles and values render; dividend-yield defect noted above. |
| Indicators | Toggled 200/150/50/20/10 MA, volume 20 MA, recent volatility, and price pattern. Checked state persisted across reload; chart overlays visually inspected. |
| Drawings | Created trend line, horizontal line, ray, rectangle, and price range; visually verified. Saved drawings returned after reload/reselecting MSFT. Clear-all removed test drawings. Individual edit/delete and exhaustive geometry edge cases not tested. |
| Watchlist | Added AAPL from chart and MSFT from search; live prices and changes appeared. Reload persistence, selecting a symbol, and removing both test entries passed. |
| Screener | Empty-input disabled state, separator parsing, condition toggles, no-condition validation, parameter editing, MA-only results, result selection, Clear, and active-run Cancel passed. 52-week filters fail as described above. Duplicate symbols count separately. |
| Symbol file import | File chooser opened, but extension rejected file attachment with `Not allowed`; application parsing could not be exercised. |
| Backtest | Default DCA and immediate-exit runs returned summary metrics and trade tables. Edit Strategy works. Negative capital produces “Capital must be a positive number.” AAPL monthly/default run showed +2.62% return and one completed trade. Numerical correctness, all operand combinations, and every range not independently validated. |
| Portfolio / orders | Drawer and tab switching work; disconnected IB errors displayed; Trade disabled. Real holdings, submission, modification, cancellation, and bracket orders were not exercised. |
| Chat | Open/collapse, model loading/selection, input, send, and error display exercised. Both tested models failed upstream. |
| Language | Traditional Chinese → English → Traditional Chinese passed; English persisted through reload during testing. |
| Panel resizing | Sidebar dragged successfully and restored. Portfolio separator moved slightly; full resize-range behavior not validated. |

## Environment and cleanup

- Initial restricted backend execution caused cache/database and network-access failures. Restarting with normal access resolved market-data loading and autocomplete without source changes.
- IB Gateway remained disconnected. No orders were placed, modified, or cancelled.
- Edge file uploads require the ChatGPT extension's “Allow access to file URLs” setting. This was not changed.
- Removed the watchlist entries and drawings created by these tests; restored initial indicator settings, Traditional Chinese, and the original chat model. The final Edge tab remains open on NVDA. Transient test chat messages remain in that tab until reload.
- Electron-only settings/packaging, mobile layouts, exhaustive keyboard accessibility, and non-UI model-retraining endpoints were outside this browser smoke pass.
