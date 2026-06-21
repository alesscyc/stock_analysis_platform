import { useState } from 'react';
import './BacktestDialog.css';

const DEFAULT_STRATEGY = `{
  "entry": {"left": "Close", "op": ">", "right": "MA_200"},
  "exit_condition": {"left": "Close", "op": "<", "right": "MA_200"},
  "exit_mode": "dca",
  "dca_periods": 3,
  "dca_unit": "month"
}`;

export default function BacktestDialog({ isOpen, onClose, selectedSymbol }) {
  const [strategyJson, setStrategyJson] = useState(localStorage.getItem('bt_strategy') || DEFAULT_STRATEGY);
  const [capital, setCapital] = useState(10000);
  const [dateRange, setDateRange] = useState('2y');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runBacktest = async () => {
    if (!selectedSymbol) { setError('Select a stock first'); return; }
    localStorage.setItem('bt_strategy', strategyJson);
    let strategyConfig;
    try {
      strategyConfig = JSON.parse(strategyJson);
    } catch (e) {
      setError('Invalid JSON: ' + e.message);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          strategyConfig,
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

  return (
    <div className={`backtest-dialog${isOpen ? '' : ' backtest-dialog-hidden'}`}>
      <div className="backtest-header">
        <span className="backtest-title">BACKTEST</span>
        <button className="backtest-close" onClick={onClose}>&times;</button>
      </div>

      {!result ? (
        <>
          <label className="backtest-label">Strategy Config (JSON)</label>
          <textarea
            className="backtest-editor"
            value={strategyJson}
            onChange={e => setStrategyJson(e.target.value)}
            rows={12}
            spellCheck={false}
          />

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

          {result?.trades?.length > 0 && (
            <div className="backtest-trades">
              <table>
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Entry $</th>
                    <th>Exit $</th>
                    <th>Return</th>
                    <th>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => {
                    const colorClass = (t.pnl ?? 0) >= 0 ? 'positive' : 'negative';
                    return (
                      <tr key={i} className={colorClass}>
                        <td>{t.entryDate}</td>
                        <td>{t.exitDate}</td>
                        <td>${t.entryPrice}</td>
                        <td>${t.exitPrice}</td>
                        <td className={colorClass}>{(t.returnPct ?? 0) >= 0 ? '+' : ''}{t.returnPct}%</td>
                        <td className={colorClass}>${(t.pnl ?? 0).toFixed(2)}</td>
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