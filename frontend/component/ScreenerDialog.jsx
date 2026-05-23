import { useState, useCallback, useRef } from 'react';
import './ScreenerDialog.css';

const API_BASE = '';

const DEFAULT_CONDITIONS = [
  { id: 'price_above_52w_low_25pct', label: 'Price ≥ 25% above 52-week low', enabled: true },
  { id: 'price_within_25pct_52w_high', label: 'Price within 25% of 52-week high', enabled: true },
  { id: 'ma200_uptrend', label: '200MA uptrend 30d (90%) & > 1M ago', enabled: true },
];

function ScreenerDialog({ isOpen, onClose, onStockSelect }) {
  const [symbolsText, setSymbolsText] = useState('');
  const [conditions, setConditions] = useState(DEFAULT_CONDITIONS);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [screenedCount, setScreenedCount] = useState(0);
  const [latestMatchedSymbol, setLatestMatchedSymbol] = useState(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);

  const parseSymbols = useCallback((text) => {
    return text
      .split(/[\n,;|]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0 && s.length <= 20 && /^[A-Z0-9.-]+$/.test(s));
  }, []);

  const toggleCondition = useCallback((id) => {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c));
  }, []);

  const enabledConditions = conditions.filter(c => c.enabled);

  const checkConditions = useCallback((data) => {
    if (!Array.isArray(data) || data.length === 0) return { pass: false, reason: 'No data' };

    const latest = data[data.length - 1];
    const close = parseFloat(latest.Close);
    const weekLow = latest['52week_low'] != null ? parseFloat(latest['52week_low']) : null;
    const weekHigh = latest['52week_high'] != null ? parseFloat(latest['52week_high']) : null;
    const ma200Uptrend30d = latest['MA200_uptrend_past_month'];
    const ma200AboveMonthAgo = latest['MA200_above_month_ago'];

    for (const cond of enabledConditions) {
      switch (cond.id) {
        case 'price_above_52w_low_25pct': {
          if (weekLow == null || close < weekLow * 1.25) {
            return { pass: false, reason: `Price $${close.toFixed(2)} < 25% above 52W low $${weekLow.toFixed(2)}` };
          }
          break;
        }
        case 'price_within_25pct_52w_high': {
          if (weekHigh == null || close < weekHigh * 0.75) {
            return { pass: false, reason: `Price $${close.toFixed(2)} > 25% below 52W high $${weekHigh.toFixed(2)}` };
          }
          break;
        }
        case 'ma200_uptrend': {
          if (ma200Uptrend30d !== 1) {
            return { pass: false, reason: '200MA not in 30-day uptrend (90% up days)' };
          }
          if (ma200AboveMonthAgo !== 1) {
            return { pass: false, reason: '200MA not above 1 month ago' };
          }
          break;
        }
        default:
          break;
      }
    }

    return { pass: true };
  }, [enabledConditions]);

  const handleRun = useCallback(async () => {
    const symbols = parseSymbols(symbolsText);
    if (symbols.length === 0) {
      setError('Enter at least one valid ticker symbol.');
      return;
    }

    if (enabledConditions.length === 0) {
      setError('Enable at least one condition.');
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResults([]);
    setScreenedCount(0);
    setLatestMatchedSymbol(null);

    let processed = 0;

    for (const symbol of symbols) {
      if (controller.signal.aborted) break;

      try {
        const response = await fetch(
          `${API_BASE}/api/stock/${symbol}?date_range=max&interval=1d&auto_predict=false`,
          { signal: controller.signal }
        );
        if (!response.ok) continue;
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) continue;

        const check = checkConditions(data);
        if (check.pass) {
          const latest = data[data.length - 1];
          const close = parseFloat(latest.Close);

          // Compute 1-week and 1-month change for display
          const weekAgo = data[Math.max(0, data.length - 6)];
          const monthAgo = data[Math.max(0, data.length - 22)];
          const weekChange = weekAgo ? ((close - parseFloat(weekAgo.Close)) / parseFloat(weekAgo.Close)) * 100 : null;
          const monthChange = monthAgo ? ((close - parseFloat(monthAgo.Close)) / parseFloat(monthAgo.Close)) * 100 : null;

          const match = {
            symbol,
            close,
            weekChange,
            monthChange,
          };

          setResults(prev => [...prev, match]);
          setLatestMatchedSymbol(symbol);
        }
      } catch {
        // ignore individual fetch failures
      } finally {
        processed++;
        setScreenedCount(processed);
      }
    }

    setLoading(false);
    abortRef.current = null;
  }, [symbolsText, enabledConditions, parseSymbols, checkConditions]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
  }, []);

  const handleRowClick = useCallback((symbol) => {
    onStockSelect({ symbol });
  }, [onStockSelect]);

  const handleClear = useCallback(() => {
    setSymbolsText('');
    setResults([]);
    setError(null);
    setScreenedCount(0);
    setLatestMatchedSymbol(null);
  }, []);

  const handleFileImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result || '';
      setSymbolsText((prev) => {
        const combined = prev ? `${prev}\n${text}` : text;
        return combined;
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const symbols = parseSymbols(symbolsText);

  return (
    <div id="screener-dialog-sidebar" className={isOpen ? '' : 'screener-hidden'} role="dialog" aria-modal="true" aria-label="Stock Screener">
      {/* Header */}
      <div id="screener-dialog-header">
        <div id="screener-header-left">
          <div id="screener-type-badge">FILTER</div>
          <h2 id="screener-dialog-title">Screener</h2>
        </div>
        <button id="screener-dialog-close-btn" onClick={onClose} aria-label="Close screener">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Symbol input */}
      <div id="screener-input-section">
        <div id="screener-input-header">
          <label id="screener-input-label" htmlFor="screener-symbols">
            Symbols <span id="screener-symbol-count">({symbols.length})</span>
          </label>
          <button
            id="screener-import-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title="Import .txt file"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Import .txt
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            style={{ display: 'none' }}
            onChange={handleFileImport}
          />
        </div>
        <textarea
          id="screener-symbols"
          rows={4}
          placeholder="AAPL, MSFT, NVDA, TSLA..."
          value={symbolsText}
          onChange={(e) => setSymbolsText(e.target.value)}
          disabled={loading}
        />
        <div id="screener-input-hint">Separate with commas, semicolons, pipes, or new lines</div>
      </div>

      {/* Conditions */}
      <div id="screener-conditions">
        <div id="screener-conditions-title">
          Conditions
          <span id="screener-conditions-active">{enabledConditions.length}/{conditions.length} active</span>
        </div>

        <div id="screener-conditions-list">
          {conditions.map((cond) => (
            <label key={cond.id} className="screener-condition-item">
              <input
                type="checkbox"
                checked={cond.enabled}
                onChange={() => toggleCondition(cond.id)}
                disabled={loading}
              />
              <span className="screener-condition-check" />
              <span className="screener-condition-text">{cond.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div id="screener-actions">
        <button
          id="screener-run-btn"
          onClick={handleRun}
          disabled={loading || symbols.length === 0}
        >
          {loading ? (
            <>
              <span className="screener-spinner" />
              Screening {screenedCount}/{symbols.length}
            </>
          ) : (
            <>Run Screener</>
          )}
        </button>
        {loading && (
          <button id="screener-cancel-btn" onClick={handleCancel}>
            Cancel
          </button>
        )}
        {!loading && results.length > 0 && (
          <button id="screener-clear-btn" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>

      {loading && latestMatchedSymbol && (
        <div id="screener-latest-match" aria-live="polite">
          Latest match: <span>{latestMatchedSymbol}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div id="screener-error-state">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div id="screener-results">
          <div id="screener-results-header">
            <span id="screener-results-title">Results</span>
            <span id="screener-results-count">{results.length} matched</span>
          </div>

          <div id="screener-results-table-wrapper">
            <table id="screener-results-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="align-right">Price</th>
                  <th className="align-right">1W</th>
                  <th className="align-right">1M</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr
                    key={row.symbol}
                    className="screener-result-row"
                    onClick={() => handleRowClick(row.symbol)}
                    title={`Click to view ${row.symbol} chart`}
                  >
                    <td className="screener-symbol-cell">{row.symbol}</td>
                    <td className="align-right screener-num">
                      ${row.close.toFixed(2)}
                    </td>
                    <td className={`align-right screener-num ${row.weekChange != null ? (row.weekChange >= 0 ? 'screener-up' : 'screener-down') : ''}`}>
                      {row.weekChange != null ? `${row.weekChange >= 0 ? '+' : ''}${row.weekChange.toFixed(1)}%` : '–'}
                    </td>
                    <td className={`align-right screener-num ${row.monthChange != null ? (row.monthChange >= 0 ? 'screener-up' : 'screener-down') : ''}`}>
                      {row.monthChange != null ? `${row.monthChange >= 0 ? '+' : ''}${row.monthChange.toFixed(1)}%` : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty result state */}
      {!loading && !error && results.length === 0 && symbols.length > 0 && (
        <div id="screener-empty-state">
          <span className="screener-empty-title">No matches</span>
          <span className="screener-empty-sub">Adjust conditions and run again.</span>
        </div>
      )}
    </div>
  );
}

export default ScreenerDialog;
