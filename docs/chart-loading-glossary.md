# Chart Loading Glossary

- **Chart load**: The point when candlesticks are visible and usable. It does not wait for AI prediction.
- **AI prediction**: The recommendation and confidence generated from daily historical data; it may appear after chart load.
- **Independent loading**: AI and backfill have separate request, cancellation, loading, and error lifecycles after first paint.
- **First paint data**: Two years of recent historical price data used to render the first usable chart.
- **Full history**: The maximum history returned by the market-data provider for a symbol.
- **Backfill**: Loading older candles from newest to oldest after the first usable chart is visible, prepending them off-screen to the left.
- **Backfill batch**: Up to five years of older candles fetched in one request.
- **Progressive loading**: Fetching first-paint data and older backfill separately, rather than merely drawing one completed response in batches.
- **Daily progressive load**: Two recent years first, then automatic five-year backfill batches. Weekly and monthly intervals do not use this path.
- **Stale response**: A response for a symbol or interval that is no longer selected; it must not update the chart.
- **Recent cache**: A reusable recent-history response considered fresh for five minutes.
- **Historical cache**: Reusable completed older backfill data whose candles no longer change.
- **Performance contract**: Cached first chart within 250 ms; uncached first chart within 2 seconds under normal network conditions.
- **Partial history**: The recent chart plus all successful backfill batches retained after a later backfill request fails.
- **Indicator warm-up**: Extra earlier candles used to calculate moving averages at a batch boundary but omitted from that batch's response.
- **Viewport preservation**: Keeping the currently visible dates unchanged while older candles are prepended off-screen.
