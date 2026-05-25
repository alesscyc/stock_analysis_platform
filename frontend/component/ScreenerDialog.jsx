import { useState, useCallback, useRef } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
import './ScreenerDialog.css';

const API_BASE = '';

const DEFAULT_CONDITIONS = [
  { id: 'price_above_52w_low_25pct', label: 'priceAbove52wLow', enabled: true },
  { id: 'price_within_25pct_52w_high', label: 'priceNear52wHigh', enabled: true },
  { id: 'ma200_uptrend', label: 'ma200Uptrend', enabled: true },
];

const DEFAULT_PARAMS = {
  lowAbovePct: 25,
  highWithinPct: 25,
  ma200Months: 1,
};

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function ScreenerDialog({ isOpen, onClose, onStockSelect }) {
  const { t } = useTranslation();
  const [symbolsText, setSymbolsText] = useState('');
  const [conditions, setConditions] = useState(DEFAULT_CONDITIONS);
  const [params, setParams] = useState(DEFAULT_PARAMS);
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

  const updateParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const checkConditions = useCallback((data) => {
    if (!Array.isArray(data) || data.length === 0) return { pass: false, reason: 'No data' };

    const latest = data[data.length - 1];
    const close = parseFloat(latest.Close);
    const weekLow = latest['52week_low'] != null ? parseFloat(latest['52week_low']) : null;
    const weekHigh = latest['52week_high'] != null ? parseFloat(latest['52week_high']) : null;
    const lowAbovePct = clampNumber(params.lowAbovePct, 0, 500, DEFAULT_PARAMS.lowAbovePct);
    const highWithinPct = clampNumber(params.highWithinPct, 0, 100, DEFAULT_PARAMS.highWithinPct);
    const ma200Months = clampNumber(params.ma200Months, 1, 24, DEFAULT_PARAMS.ma200Months);
    const ma200Days = Math.round(ma200Months * 22);

    for (const cond of enabledConditions) {
      switch (cond.id) {
        case 'price_above_52w_low_25pct': {
          if (!Number.isFinite(close) || !Number.isFinite(weekLow)) {
            return { pass: false, reason: '52-week low data unavailable' };
          }
          const minPrice = weekLow * (1 + lowAbovePct / 100);
          if (close < minPrice) {
            return { pass: false, reason: `Price $${close.toFixed(2)} < ${lowAbovePct}% above 52W low $${weekLow.toFixed(2)}` };
          }
          break;
        }
        case 'price_within_25pct_52w_high': {
          if (!Number.isFinite(close) || !Number.isFinite(weekHigh)) {
            return { pass: false, reason: '52-week high data unavailable' };
          }
          const minPrice = weekHigh * (1 - highWithinPct / 100);
          if (close < minPrice) {
            return { pass: false, reason: `Price $${close.toFixed(2)} > ${highWithinPct}% below 52W high $${weekHigh.toFixed(2)}` };
          }
          break;
        }
        case 'ma200_uptrend': {
          const latestMa200Index = [...data].reverse().findIndex(row => Number.isFinite(parseFloat(row['200MA'])));
          const endIndex = latestMa200Index === -1 ? -1 : data.length - 1 - latestMa200Index;
          const startIndex = endIndex - ma200Days;

          if (startIndex < 0) {
            return { pass: false, reason: `Not enough 200MA data for ${ma200Months} month(s)` };
          }

          let upDays = 0;
          for (let i = startIndex + 1; i <= endIndex; i++) {
            const currentMa = parseFloat(data[i]['200MA']);
            const previousMa = parseFloat(data[i - 1]['200MA']);
            if (!Number.isFinite(currentMa) || !Number.isFinite(previousMa)) {
              return { pass: false, reason: `Incomplete 200MA data for ${ma200Months} month(s)` };
            }
            if (currentMa > previousMa) upDays++;
          }

          const requiredUpDays = Math.ceil(ma200Days * 0.9);
          if (upDays < requiredUpDays) {
            return { pass: false, reason: `200MA is not in an uptrend over ${ma200Months} month(s)` };
          }

          const currentMa = parseFloat(data[endIndex]['200MA']);
          const pastMa = parseFloat(data[startIndex]['200MA']);
          if (currentMa <= pastMa) {
            return { pass: false, reason: `200MA not above ${ma200Months} month(s) ago` };
          }
          break;
        }
        default:
          break;
      }
    }

    return { pass: true };
  }, [enabledConditions, params]);

  const handleRun = useCallback(async () => {
    const symbols = parseSymbols(symbolsText);
    if (symbols.length === 0) {
      setError(t('enterAtLeastOneSymbol'));
      return;
    }

    if (enabledConditions.length === 0) {
      setError(t('enableAtLeastOneCondition'));
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
  }, [symbolsText, enabledConditions, parseSymbols, checkConditions, t]);

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
          <div id="screener-type-badge">{t('filter')}</div>
          <h2 id="screener-dialog-title">{t('screener')}</h2>
        </div>
        <button id="screener-dialog-close-btn" onClick={onClose} aria-label={t('closeScreener')}>
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
            {t('symbols')} <span id="screener-symbol-count">({symbols.length})</span>
          </label>
          <button
            id="screener-import-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title={t('importTxt')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {t('importTxt')}
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
          placeholder={t('symbolsPlaceholder')}
          value={symbolsText}
          onChange={(e) => setSymbolsText(e.target.value)}
          disabled={loading}
        />
        <div id="screener-input-hint">{t('separateHint')}</div>
      </div>

      {/* Conditions */}
      <div id="screener-conditions">
        <div id="screener-conditions-title">
          {t('conditions')}
          <span id="screener-conditions-active">{t('activeCount', { active: enabledConditions.length, total: conditions.length })}</span>
        </div>

        <div id="screener-conditions-list">
          {conditions.map((cond) => (
            <div key={cond.id} className="screener-condition-block">
              <label className="screener-condition-item">
                <input
                  type="checkbox"
                  checked={cond.enabled}
                  onChange={() => toggleCondition(cond.id)}
                  disabled={loading}
                />
                <span className="screener-condition-check" />
                <span className="screener-condition-text">{t(cond.label)}</span>
              </label>

              {cond.id === 'price_above_52w_low_25pct' && (
                <label className="screener-condition-control">
                  <span>{t('atLeast')}</span>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="1"
                    value={params.lowAbovePct}
                    onChange={(e) => updateParam('lowAbovePct', e.target.value)}
                    disabled={loading || !cond.enabled}
                  />
                  <span>{t('pctAboveLow')}</span>
                </label>
              )}

              {cond.id === 'price_within_25pct_52w_high' && (
                <label className="screener-condition-control">
                  <span>{t('within')}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={params.highWithinPct}
                    onChange={(e) => updateParam('highWithinPct', e.target.value)}
                    disabled={loading || !cond.enabled}
                  />
                  <span>{t('pctOfHigh')}</span>
                </label>
              )}

              {cond.id === 'ma200_uptrend' && (
                <label className="screener-condition-control">
                  <span>{t('past')}</span>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="1"
                    value={params.ma200Months}
                    onChange={(e) => updateParam('ma200Months', e.target.value)}
                    disabled={loading || !cond.enabled}
                  />
                  <span>{t('months')}</span>
                </label>
              )}
            </div>
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
              {t('screeningCount', { current: screenedCount, total: symbols.length })}
            </>
          ) : (
            <>{t('runScreener')}</>
          )}
        </button>
        {loading && (
          <button id="screener-cancel-btn" onClick={handleCancel}>
            {t('cancel')}
          </button>
        )}
        {!loading && results.length > 0 && (
          <button id="screener-clear-btn" onClick={handleClear}>
            {t('clear')}
          </button>
        )}
      </div>

      {loading && latestMatchedSymbol && (
        <div id="screener-latest-match" aria-live="polite">
          {t('latestMatch', { symbol: latestMatchedSymbol })}
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
            <span id="screener-results-title">{t('results')}</span>
            <span id="screener-results-count">{t('matchedCount', { count: results.length })}</span>
          </div>

          <div id="screener-results-table-wrapper">
            <table id="screener-results-table">
              <thead>
                <tr>
                  <th>{t('symbol')}</th>
                  <th className="align-right">{t('price')}</th>
                  <th className="align-right">{t('oneWeek')}</th>
                  <th className="align-right">{t('oneMonth')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr
                    key={row.symbol}
                    className="screener-result-row"
                    onClick={() => handleRowClick(row.symbol)}
                    title={t('clickToViewChart', { symbol: row.symbol })}
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
          <span className="screener-empty-title">{t('noMatches')}</span>
          <span className="screener-empty-sub">{t('adjustConditions')}</span>
        </div>
      )}
    </div>
  );
}

export default ScreenerDialog;
