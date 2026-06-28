import { useState } from 'react';
import './BacktestDialog.css';

const OPERATORS = ['>', '<', '>=', '<='];
const MA_PERIOD_MIN = 2;
const MA_PERIOD_MAX = 500;

const OPERAND_OPTIONS = [
  { value: 'Close', label: 'Close Price' },
  { value: '__ma__', label: 'Moving Average' },
  { value: '__number__', label: 'Fixed Number' },
];

const DEFAULT_STRATEGY = {
  entryLeft: 'Close',
  entryLeftNum: '',
  entryOp: '>',
  entryRight: '__ma__',
  entryRightNum: '200',
  exitLeft: 'Close',
  exitLeftNum: '',
  exitOp: '<',
  exitRight: '__ma__',
  exitRightNum: '200',
  exitMode: 'dca',
  dcaPeriods: 3,
  dcaUnit: 'month',
  evalFrequency: 'monthly',
};

function resolveOperand(selectVal, numVal) {
  if (selectVal === '__number__') {
    const raw = String(numVal ?? '').trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (selectVal === '__ma__') {
    const raw = String(numVal ?? '').trim();
    if (raw === '') return null;
    const period = Number.parseInt(raw, 10);
    if (!Number.isFinite(period) || period < MA_PERIOD_MIN || period > MA_PERIOD_MAX) return null;
    return `MA_${period}`;
  }
  return selectVal;
}

function buildStrategyConfig(form) {
  const entryLeft = resolveOperand(form.entryLeft, form.entryLeftNum);
  const entryRight = resolveOperand(form.entryRight, form.entryRightNum);
  const exitLeft = resolveOperand(form.exitLeft, form.exitLeftNum);
  const exitRight = resolveOperand(form.exitRight, form.exitRightNum);

  if ([entryLeft, entryRight, exitLeft, exitRight].some(v => v == null || v === '')) {
    return { error: 'Fill all condition fields (use valid MA periods and numbers)' };
  }

  const config = {
    entry: { left: entryLeft, op: form.entryOp, right: entryRight },
    exit_condition: { left: exitLeft, op: form.exitOp, right: exitRight },
    exit_mode: form.exitMode,
  };

  if (form.exitMode === 'dca') {
    config.dca_periods = Number(form.dcaPeriods) || 3;
    config.dca_unit = form.dcaUnit;
    if (form.evalFrequency === 'monthly' && config.dca_unit === 'week') {
      config.dca_unit = 'month';
    }
  }

  config.eval_frequency = form.evalFrequency || 'daily';

  return { config };
}

function normalizeFormStrategy(form) {
  const next = { ...DEFAULT_STRATEGY, ...form };
  const migrateSide = (selectKey, numKey) => {
    const val = next[selectKey];
    if (typeof val === 'string' && /^MA_\d+$/.test(val)) {
      next[selectKey] = '__ma__';
      next[numKey] = val.split('_')[1];
    }
  };
  migrateSide('entryLeft', 'entryLeftNum');
  migrateSide('entryRight', 'entryRightNum');
  migrateSide('exitLeft', 'exitLeftNum');
  migrateSide('exitRight', 'exitRightNum');
  return next;
}

function loadStoredStrategy() {
  const stored = localStorage.getItem('bt_strategy');
  if (!stored) return DEFAULT_STRATEGY;
  try {
    const parsed = JSON.parse(stored);
    if (parsed.entry && typeof parsed.entry === 'object') {
      return normalizeFormStrategy(migrateLegacyConfig(parsed));
    }
    return normalizeFormStrategy(parsed);
  } catch {
    return DEFAULT_STRATEGY;
  }
}

function migrateLegacyConfig(config) {
  const toFormSide = (val) => {
    if (typeof val === 'number') return { select: '__number__', num: String(val) };
    if (typeof val === 'string' && /^MA_\d+$/.test(val)) {
      return { select: '__ma__', num: val.split('_')[1] };
    }
    return { select: String(val), num: '' };
  };

  const entryL = toFormSide(config.entry?.left ?? 'Close');
  const entryR = toFormSide(config.entry?.right ?? 'MA_200');
  const exitL = toFormSide(config.exit_condition?.left ?? config.exit?.left ?? 'Close');
  const exitR = toFormSide(config.exit_condition?.right ?? config.exit?.right ?? 'MA_200');

  return {
    entryLeft: entryL.select,
    entryLeftNum: entryL.num,
    entryOp: config.entry?.op ?? '>',
    entryRight: entryR.select,
    entryRightNum: entryR.num,
    exitLeft: exitL.select,
    exitLeftNum: exitL.num,
    exitOp: config.exit_condition?.op ?? config.exit?.op ?? '<',
    exitRight: exitR.select,
    exitRightNum: exitR.num,
    exitMode: config.exit_mode ?? 'dca',
    dcaPeriods: config.dca_periods ?? 3,
    dcaUnit: config.dca_unit ?? 'month',
    evalFrequency: config.eval_frequency ?? 'monthly',
  };
}

function tradesToActions(trades) {
  if (!trades?.length) return [];

  const actions = [];
  let lastEntryDate = null;
  let seq = 0;

  for (const t of trades) {
    if (t.entryDate && t.entryDate !== lastEntryDate) {
      actions.push({
        date: t.entryDate,
        side: 'BUY',
        price: t.entryPrice,
        pnl: null,
        seq: seq++,
      });
      lastEntryDate = t.entryDate;
    }
    actions.push({
      date: t.exitDate,
      side: 'SELL',
      price: t.exitPrice,
      pnl: t.pnl,
      seq: seq++,
    });
  }

  return actions.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.seq - b.seq;
  });
}

function RuleRow({ label, left, leftNum, op, right, rightNum, onChange }) {
  const showLeftNum = left === '__number__' || left === '__ma__';
  const showRightNum = right === '__number__' || right === '__ma__';
  const leftPlaceholder = left === '__ma__' ? 'Period' : 'Value';
  const rightPlaceholder = right === '__ma__' ? 'Period' : 'Value';

  return (
    <div className="backtest-rule">
      <span className="backtest-rule-label">{label}</span>
      <div className="backtest-rule-row">
        <select value={left} onChange={e => onChange('left', e.target.value)}>
          {OPERAND_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {showLeftNum && (
          <input
            type="number"
            className="backtest-rule-num"
            value={leftNum}
            onChange={e => onChange('leftNum', e.target.value)}
            placeholder={leftPlaceholder}
            min={left === '__ma__' ? MA_PERIOD_MIN : undefined}
            max={left === '__ma__' ? MA_PERIOD_MAX : undefined}
            step={left === '__ma__' ? 1 : 'any'}
          />
        )}
        <select className="backtest-rule-op" value={op} onChange={e => onChange('op', e.target.value)}>
          {OPERATORS.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select value={right} onChange={e => onChange('right', e.target.value)}>
          {OPERAND_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {showRightNum && (
          <input
            type="number"
            className="backtest-rule-num"
            value={rightNum}
            onChange={e => onChange('rightNum', e.target.value)}
            placeholder={rightPlaceholder}
            min={right === '__ma__' ? MA_PERIOD_MIN : undefined}
            max={right === '__ma__' ? MA_PERIOD_MAX : undefined}
            step={right === '__ma__' ? 1 : 'any'}
          />
        )}
      </div>
    </div>
  );
}

export default function BacktestDialog({ isOpen, onClose, selectedSymbol }) {
  const [strategy, setStrategy] = useState(loadStoredStrategy);
  const [capital, setCapital] = useState(10000);
  const [dateRange, setDateRange] = useState('2y');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const updateStrategy = (key, value) => {
    setStrategy(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'evalFrequency' && value === 'monthly' && next.dcaUnit === 'week') {
        next.dcaUnit = 'month';
      }
      return next;
    });
  };

  const updateEntry = (field, value) => {
    const map = { left: 'entryLeft', leftNum: 'entryLeftNum', op: 'entryOp', right: 'entryRight', rightNum: 'entryRightNum' };
    updateStrategy(map[field], value);
  };

  const updateExit = (field, value) => {
    const map = { left: 'exitLeft', leftNum: 'exitLeftNum', op: 'exitOp', right: 'exitRight', rightNum: 'exitRightNum' };
    updateStrategy(map[field], value);
  };

  const runBacktest = async () => {
    if (!selectedSymbol) { setError('Select a stock first'); return; }

    const { config, error: buildError } = buildStrategyConfig(strategy);
    if (buildError) {
      setError(buildError);
      return;
    }

    localStorage.setItem('bt_strategy', JSON.stringify(strategy));
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          strategyConfig: config,
          capital,
          dateRange,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Backtest failed');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const reset = () => { setResult(null); setError(null); };

  const m = result?.metrics;
  const tradeActions = tradesToActions(result?.trades);

  return (
    <div className={`backtest-dialog${isOpen ? '' : ' backtest-dialog-hidden'}`}>
      <div className="backtest-header">
        <span className="backtest-title">BACKTEST</span>
        <button className="backtest-close" onClick={onClose}>&times;</button>
      </div>

      {!result ? (
        <>
          <div className="backtest-form">
            <RuleRow
              label="Buy When"
              left={strategy.entryLeft}
              leftNum={strategy.entryLeftNum}
              op={strategy.entryOp}
              right={strategy.entryRight}
              rightNum={strategy.entryRightNum}
              onChange={updateEntry}
            />

            <RuleRow
              label="Sell When"
              left={strategy.exitLeft}
              leftNum={strategy.exitLeftNum}
              op={strategy.exitOp}
              right={strategy.exitRight}
              rightNum={strategy.exitRightNum}
              onChange={updateExit}
            />

            <div className="backtest-section">
              <span className="backtest-label">Exit Mode</span>
              <div className="backtest-controls-row">
                <div className="backtest-field">
                  <select
                    value={strategy.exitMode}
                    onChange={e => updateStrategy('exitMode', e.target.value)}
                  >
                    <option value="immediate">Sell All Immediately</option>
                    <option value="dca">DCA Out (Gradual)</option>
                  </select>
                </div>
              </div>
            </div>

            {strategy.exitMode === 'dca' && (
              <div className="backtest-controls-row">
                <div className="backtest-field">
                  <label>DCA Periods</label>
                  <input
                    type="number"
                    value={strategy.dcaPeriods}
                    onChange={e => updateStrategy('dcaPeriods', Number(e.target.value) || 1)}
                    min={1}
                    max={24}
                  />
                </div>
                <div className="backtest-field">
                  <label>DCA Unit</label>
                  <select
                    value={strategy.evalFrequency === 'monthly' ? 'month' : strategy.dcaUnit}
                    onChange={e => updateStrategy('dcaUnit', e.target.value)}
                    disabled={strategy.evalFrequency === 'monthly'}
                  >
                    <option value="month">Monthly</option>
                    {strategy.evalFrequency !== 'monthly' && (
                      <option value="week">Weekly</option>
                    )}
                  </select>
                </div>
              </div>
            )}

            <div className="backtest-section">
              <span className="backtest-label">Signal Check</span>
              <div className="backtest-controls-row">
                <div className="backtest-field">
                  <select
                    value={strategy.evalFrequency}
                    onChange={e => updateStrategy('evalFrequency', e.target.value)}
                  >
                    <option value="daily">Every Trading Day</option>
                    <option value="monthly">Monthly (First Trading Day)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="backtest-controls-row">
              <div className="backtest-field">
                <label>Capital ($)</label>
                <input
                  type="number"
                  value={capital}
                  onChange={e => setCapital(Number(e.target.value) || 0)}
                  min={100}
                  step={1000}
                />
              </div>
              <div className="backtest-field">
                <label>Range</label>
                <select value={dateRange} onChange={e => setDateRange(e.target.value)}>
                  <option value="1y">1 Year</option>
                  <option value="2y">2 Years</option>
                  <option value="5y">5 Years</option>
                  <option value="max">Max</option>
                </select>
              </div>
            </div>
          </div>

          {error && <div className="backtest-error">{error}</div>}

          <button
            className="backtest-run"
            onClick={runBacktest}
            disabled={running || !selectedSymbol}
          >
            {running ? 'Running...' : 'Run Backtest'}
          </button>
        </>
      ) : (
        <>
          <div className="backtest-metrics">
            <div className="backtest-metric good">
              <span className="backtest-metric-value">{(m?.totalReturn ?? 0) >= 0 ? '+' : ''}{m?.totalReturn ?? '-'}%</span>
              <span className="backtest-metric-label">Return</span>
            </div>
            <div className="backtest-metric">
              <span className="backtest-metric-value">{m?.sharpe ?? '-'}</span>
              <span className="backtest-metric-label">Sharpe</span>
            </div>
            <div className="backtest-metric bad">
              <span className="backtest-metric-value">{(m?.maxDrawdown ?? 0) >= 0 ? '-' : ''}{Math.abs(m?.maxDrawdown ?? 0)}%</span>
              <span className="backtest-metric-label">Max DD</span>
            </div>
            <div className="backtest-metric">
              <span className="backtest-metric-value">{m?.cagr ?? '-'}%</span>
              <span className="backtest-metric-label">CAGR</span>
            </div>
            <div className="backtest-metric">
              <span className="backtest-metric-value">{m?.winRate != null ? (m.winRate * 100).toFixed(0) + '%' : '-'}</span>
              <span className="backtest-metric-label">Win Rate</span>
            </div>
            <div className="backtest-metric">
              <span className="backtest-metric-value">{m?.profitFactor ?? '-'}</span>
              <span className="backtest-metric-label">P/L Factor</span>
            </div>
            <div className="backtest-metric">
              <span className="backtest-metric-value">{m?.numTrades ?? '-'}</span>
              <span className="backtest-metric-label">Trades</span>
            </div>
            <div className="backtest-metric">
              <span className="backtest-metric-value">{m?.avgReturn ?? '-'}%</span>
              <span className="backtest-metric-label">Avg Return</span>
            </div>
          </div>

          {tradeActions.length > 0 && (
            <div className="backtest-trades">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Action</th>
                    <th>Price</th>
                    <th>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeActions.map((a, i) => {
                    const isSell = a.side === 'SELL';
                    const colorClass = isSell ? ((a.pnl ?? 0) >= 0 ? 'positive' : 'negative') : '';
                    return (
                      <tr key={i} className={colorClass}>
                        <td>{a.date}</td>
                        <td className={`backtest-side backtest-side-${a.side.toLowerCase()}`}>{a.side}</td>
                        <td>${a.price}</td>
                        <td className={colorClass}>
                          {isSell ? `$${(a.pnl ?? 0).toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {error && <div className="backtest-error">{error}</div>}

          <div className="backtest-actions">
            <button className="backtest-back" onClick={reset}>Edit Strategy</button>
            <button className="backtest-run" onClick={runBacktest} disabled={running}>
              {running ? 'Running...' : 'Run Again'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
