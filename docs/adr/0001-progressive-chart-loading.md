# ADR 0001: Progressive Chart Loading

Status: Accepted

## Context

The chart currently waits for historical prices, technical indicators, and the AI prediction to return in one response before rendering.

## Decisions

- Treat candlesticks becoming visible as the chart-load completion point.
- Allow the AI prediction to finish and appear afterward.
- Preserve access to full history, but load it progressively: render a recent history slice first, then backfill older candles.
- Do not simulate progressive loading by batching an already-downloaded JSON response; that does not improve time to first chart.
- Load history from newest to oldest.
- Prepend older candles without changing the visible viewport.
- Use two years of daily history for the first chart response (about 500 candles), enough to support the 200-day moving average and current patterns.
- Start older-history backfill automatically after the first chart renders.
- Cancel in-flight chart and backfill requests when the symbol or interval changes.
- Fetch older history in fixed five-year batches, stopping when the server returns no older candles.
- After first paint, start AI prediction and history backfill in parallel; neither may block or cancel the other.
- Run synchronous Python market-data work without blocking the service from handling another request.
- Apply progressive loading only to daily charts. Weekly and monthly charts load their smaller full-history datasets in one request so long-period indicators remain complete.
- Render cached recent candles immediately when revisiting a symbol. Refresh the recent slice in the background after five minutes; reuse immutable older backfill batches longer.
- Target cached chart visibility within 250 ms and an uncached two-year chart within 2 seconds on a normal connection.
- Verify that AI and backfill cannot delay first paint, using deterministic delayed-response tests; supplement with live timing when the local stack is available.
- Keep the visible chart usable if AI or backfill fails. Show `AI unavailable` for prediction failure and `History partially loaded` for backfill failure; never clear chart data for either background failure.
- Show separate inline `AI analyzing...` and `Loading older history...` states after first paint. Do not overlay the chart or disable its controls.

## Implementation outline

- Keep the existing full-history route behavior for weekly and monthly intervals.
- Extend daily history requests with validated date windows so the client can request five-year batches ending before its oldest candle.
- Include 400 calendar days of earlier warm-up data when calculating each batch, then trim it from the response, so moving averages remain continuous at batch boundaries.
- Add a prediction-only route so AI does not return another full chart payload.
- Merge batches by `Date`, retain chronological order, and stop when no older rows are returned.
- Retry each uncached no-progress window once and require two consecutive empty five-year windows before marking full history complete.
- Preserve the current visible range across backfill `setData` calls; only set the initial range for a new symbol or interval.
- Keep recent responses fresh for five minutes and older completed batches for 24 hours.
- Use one abort lifecycle per symbol/interval selection to prevent stale chart, AI, or backfill updates.

## Verification

- Add a small runnable test for ordered merge, deduplication, cancellation, and first-paint independence.
- Run the existing frontend tests, lint, and production build.
- Verify cached and delayed uncached behavior in the browser when the local services are available.
