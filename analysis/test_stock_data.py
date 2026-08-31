import io
import json
import sys
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

import stock_data


class FakeTicker:
    def __init__(self):
        index = pd.date_range('2023-01-02', periods=800, freq='B')
        price = np.arange(len(index), dtype=float) + 100
        self.frame = pd.DataFrame({
            'Open': price,
            'High': price + 2,
            'Low': price - 2,
            'Close': price + 1,
            'Volume': np.full(len(index), 1000),
        }, index=index)

    @property
    def info(self):
        raise AssertionError('chart-only history must not fetch ticker.info')

    def history(self, **kwargs):
        frame = self.frame
        if kwargs.get('start'):
            frame = frame[frame.index >= kwargs['start']]
        if kwargs.get('end'):
            frame = frame[frame.index < kwargs['end']]
        return frame.copy()


class StockHistoryWindowTest(unittest.TestCase):
    @patch.object(stock_data.yf, 'Ticker', return_value=FakeTicker())
    def test_window_is_trimmed_after_indicator_warmup(self, _ticker):
        rows = stock_data.get_stock_price_history(
            'TEST',
            interval='1d',
            start_date='2025-01-02',
            end_date='2026-01-01',
            include_market_cap=False,
        )

        self.assertGreater(len(rows), 0)
        self.assertGreaterEqual(rows[0]['Date'], '2025-01-02')
        self.assertIsNotNone(rows[0]['200MA'])
        self.assertNotIn('MarketCap', rows[0])

    @patch.object(stock_data.yf, 'Ticker', return_value=FakeTicker())
    def test_empty_old_window_ends_backfill_cleanly(self, _ticker):
        self.assertEqual(stock_data.get_stock_price_history(
            'TEST',
            interval='1d',
            start_date='1990-01-01',
            end_date='1991-01-01',
            include_market_cap=False,
        ), [])


class IncompleteBarTicker(FakeTicker):
    def __init__(self):
        super().__init__()
        self.frame.iloc[-1, self.frame.columns.get_indexer(['Open', 'High', 'Low', 'Close'])] = np.nan


class IncompleteBarJsonTest(unittest.TestCase):
    @patch.object(stock_data.yf, 'Ticker', return_value=IncompleteBarTicker())
    def test_history_drops_nan_ohlc_bar(self, _ticker):
        rows = stock_data.get_stock_price_history(
            'TEST', date_range='1y', interval='1d', include_market_cap=False,
        )
        json.dumps(rows, allow_nan=False)
        self.assertTrue(all(np.isfinite(row['Close']) for row in rows))

    @patch.object(stock_data.yf, 'Ticker', return_value=IncompleteBarTicker())
    def test_current_price_skips_nan_last_close(self, _ticker):
        result = stock_data.get_current_stock_price('TEST')
        json.dumps(result, allow_nan=False)
        self.assertTrue(np.isfinite(result['price']))


class BacktestWorkerTest(unittest.TestCase):
    def test_cli_worker_reads_stdin_and_prints_json(self):
        params = {
            'symbol': 'TEST',
            'strategy_config': {'entry': {'left': 'Close', 'op': '>', 'right': 'MA_200'}},
            'capital': 10000,
            'date_range': '1y',
            'interval': '1d',
        }
        with patch.object(stock_data, 'run_backtest', return_value={'symbol': 'TEST', 'error': None}) as mock_run:
            out = io.StringIO()
            with patch.object(sys, 'stdin', io.StringIO(json.dumps(params))), \
                 patch.object(sys, 'stdout', out):
                stock_data.run_backtest_worker()
        mock_run.assert_called_once_with(**params)
        self.assertEqual(json.loads(out.getvalue()), {'symbol': 'TEST', 'error': None})


if __name__ == '__main__':
    unittest.main()
