import { memo, useState, useCallback, useRef } from 'react';
import { useTranslation } from '../src/i18n/useTranslation';
import PanelCloseButton from './PanelCloseButton';
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

const ResultChart = memo(function ResultChart({ data }) {
  const { t } = useTranslation();
  const points = data.slice(-126).map(row => ({
    date: row.Date,
    open: parseFloat(row.Open), high: parseFloat(row.High),
    low: parseFloat(row.Low), close: parseFloat(row.Close),
  })).filter(row => [row.open, row.high, row.low, row.close].every(Number.isFinite)
    && row.high >= Math.max(row.open, row.close)
    && row.low <= Math.min(row.open, row.close));
  if (points.length < 2) return <span className="screener-chart-empty">{t('screenerChartUnavailable')}</span>;
  const low = Math.min(...points.map(row => row.low));
  const high = Math.max(...points.map(row => row.high));
  const range = high - low || 1;
  const y = price => 76 - (price - low) / range * 64;
  const step = 300 / points.length;
  const width = Math.min(8, step * 0.65);
  const paths = { up: { wicks: '', bodies: '' }, down: { wicks: '', bodies: '' } };
  points.forEach((row, index) => {
    const x = (index + 0.5) * step;
    const top = y(Math.max(row.open, row.close));
    const height = Math.max(1, Math.abs(y(row.open) - y(row.close)));
    const path = paths[row.close >= row.open ? 'up' : 'down'];
    path.wicks += `M${x},${y(row.high)}V${y(row.low)}`;
    path.bodies += `M${x - width / 2},${top}h${width}v${height}h${-width}Z`;
  });
  return (
    <span className="screener-chart">
      <svg viewBox="0 0 300 88" aria-hidden="true" focusable="false">
        <path d="M0,12 H300 M0,44 H300 M0,76 H300" className="screener-chart-grid" />
        {Object.entries(paths).map(([direction, path]) => (
          <g key={direction} className={`screener-candle-${direction}`}>
            <path d={path.wicks} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />
            <path d={path.bodies} fill="currentColor" />
          </g>
        ))}
      </svg>
      <span className="screener-chart-dates"><span>{String(points[0].date).slice(0, 10)}</span><span>{String(points.at(-1).date).slice(0, 10)}</span></span>
    </span>
  );
});

function ScreenerDialog({ isOpen, onClose, onStockSelect, onStockDataScanned }) {
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

        onStockDataScanned?.(symbol, data, {
          dateRange: 'max',
          interval: '1d',
          autoPredict: false,
        });

        const check = checkConditions(data);
        if (check.pass) {
          const latest = data[data.length - 1];
          const close = parseFloat(latest.Close);

          const match = { symbol, close, chartData: data };

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
  }, [symbolsText, enabledConditions, parseSymbols, checkConditions, onStockDataScanned, t]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
  }, []);

  const handleRowClick = useCallback((row) => {
    onStockSelect({
      symbol: row.symbol,
      chartData: row.chartData,
      chartDataMeta: {
        dateRange: 'max',
        interval: '1d',
        autoPredict: false,
      },
    });
  }, [onStockSelect]);

  const handleResultRowKeyDown = useCallback((event, row, index) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleRowClick(row);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.min(results.length - 1, Math.max(0, index + direction));
    event.currentTarget.parentElement?.children[nextIndex]?.focus();
    handleRowClick(results[nextIndex]);
  }, [handleRowClick, results]);

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
    <div id="screener-dialog-sidebar" className={isOpen ? '' : 'screener-hidden'} role="dialog" aria-modal="true" aria-label={t('screener')}>
      {/* Header */}
      <div id="screener-dialog-header">
        <div id="screener-header-left">
          <div id="screener-type-badge">{t('filter')}</div>
          <h2 id="screener-dialog-title">{t('screener')}</h2>
        </div>
        <PanelCloseButton onClick={onClose} label={t('closeScreener')} />
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
          rows={2}
          placeholder={t('symbolsPlaceholder')}
          value={symbolsText}
          onChange={(e) => setSymbolsText(e.target.value)}
          disabled={loading}
        />
        <div id="screener-input-hint">{t('separateHint')}</div>
      </div>

      {/* Conditions */}
      <details id="screener-conditions">
        <summary id="screener-conditions-title">
          <span className="screener-conditions-heading">
            {t('conditions')}
            <span id="screener-conditions-active">{t('activeCount', { active: enabledConditions.length, total: conditions.length })}</span>
          </span>
        </summary>

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
      </details>

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

          <div id="screener-results-list">
            {results.map((row, index) => (
              <button
                key={`${row.symbol}-${index}`}
                className="screener-result-row"
                onClick={() => handleRowClick(row)}
                onKeyDown={(event) => handleResultRowKeyDown(event, row, index)}
                title={t('clickToViewChart', { symbol: row.symbol })}
                aria-label={t('clickToViewChart', { symbol: row.symbol })}
              >
                <span className="screener-result-heading">
                  <span className="screener-symbol-cell">{row.symbol}</span>
                  <span className="screener-num">${row.close.toFixed(2)}</span>
                </span>
                <ResultChart data={row.chartData} />
              </button>
            ))}
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
