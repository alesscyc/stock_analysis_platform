# Analysis

Python market-data, indicator, ML, prediction, fundamentals, and backtesting service. Most implementation lives in stock_data.py.

## Interfaces

- FastAPI is the normal backend interface. Express starts and supervises it.
- CLI modes support direct history/current-price checks and the backtest worker.
- The backtest endpoint launches a subprocess so it can enforce a timeout.
- Models are cached in memory and as per-symbol pickle files under MODEL_CACHE_DIR, which defaults to analysis/model_cache/.

See _make_fastapi_app() and the __main__ dispatch in stock_data.py for the current endpoints and CLI modes. Do not duplicate those lists here.

## Invariants

- CLI stdout must contain only JSON. Send diagnostics and service startup messages to stderr.
- Return JSON-safe values: convert NumPy/pandas scalars and remove NaN or infinite values.
- Validate symbols, date ranges, intervals, and strategy inputs at the boundary.
- Preserve the warm-up history needed by rolling indicators before trimming requested dates.
- ML features and labels are daily-data behavior; do not silently apply them to weekly or monthly intervals.
- Keep model files out of Git. Respect MODEL_CACHE_DIR so packaged Electron builds can use their user-data directory.
- Avoid hidden network calls in tests. Mock yfinance or use small in-memory data.
- Keep imports usable both as a service and by test_stock_data.py.

## Development

Install dependencies from analysis/requirements.txt. The root development flow starts this service through Express; run it directly only when debugging:

    cd analysis
    python stock_data.py serve

## Checks

From the repository root:

    (cd analysis && python -m unittest test_stock_data.py)

Add a focused unittest for changed calculations, serialization, validation, caching, or dispatch behavior.
