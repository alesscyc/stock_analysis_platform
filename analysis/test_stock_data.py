import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
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
    @patch.object(stock_data.yf, 'Ticker', return_value=FakeTicker())
    def test_valid_strategy_produces_finite_results(self, _ticker):
        result = stock_data.run_backtest('TEST', {
            'entry': {'left': 'Close', 'op': '>', 'right': 'MA_20'},
            'exit_condition': {'left': 'Close', 'op': '<', 'right': 'MA_20'},
        })
        self.assertIsNone(result['error'])
        self.assertGreater(len(result['trades']), 0)
        json.dumps(result, allow_nan=False)

    def test_invalid_strategies_fail_before_fetching_data(self):
        valid = {
            'entry': {'left': 'Close', 'op': '>', 'right': 'MA_20'},
            'exit_condition': {'left': 'Close', 'op': '<', 'right': 'MA_20'},
        }
        with patch.object(stock_data, 'get_stock_price_history') as fetch:
            for config in ('{broken', [], {}, {**valid, 'dca_periods': 0},
                           {**valid, 'dca_periods': 1.5}, {**valid, 'exit_mode': 'typo'},
                           {**valid, 'entry': {'left': 'Close', 'op': '>', 'right': 'MA_999999'}}):
                with self.subTest(config=config):
                    error = stock_data.run_backtest('TEST', config).get('error')
                    self.assertIsInstance(error, str)
                    self.assertTrue(error.strip())
            error = stock_data.run_backtest('TEST', valid, capital=float('inf')).get('error')
            self.assertIsInstance(error, str)
            self.assertTrue(error.strip())
            fetch.assert_not_called()

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


class PredictionProbabilityTest(unittest.TestCase):
    def test_probabilities_follow_trained_classes(self):
        from sklearn.ensemble import RandomForestClassifier

        for labels in ([0, 0], [1, 1], [0, 1]):
            with self.subTest(labels=labels):
                model = RandomForestClassifier(n_estimators=3, random_state=42)
                model.fit([[0], [1]], labels)
                result = stock_data.predict_stock_recommendation(
                    [{'Date': '2026-01-02', 'Close': 100, 'signal': 1}],
                    {'model': model, 'feature_names': ['signal']},
                )
                expected = dict(zip(model.classes_, model.predict_proba([[1]])[0] * 100))
                self.assertNotIn('error', result)
                self.assertEqual(result['sell_probability'], round(expected.get(0, 0), 2))
                self.assertEqual(result['buy_probability'], round(expected.get(1, 0), 2))
                self.assertEqual(result['confidence'], round(max(expected.values()), 2))
                self.assertEqual(result['recommendation'], 'BUY' if model.predict([[1]])[0] else 'SELL')
                json.dumps(result, allow_nan=False)


class ModelTrainingTest(unittest.TestCase):
    @patch.object(stock_data.yf, 'Ticker', return_value=FakeTicker())
    @patch.object(stock_data, '_get_cached_model', return_value=None)
    def test_unknown_labels_are_excluded_and_training_has_a_horizon_gap(self, *_mocks):
        from sklearn.ensemble import RandomForestClassifier

        with patch.object(stock_data, 'train_random_forest_model', return_value={'error': 'skip'}), \
             patch.object(sys, 'stderr', io.StringIO()):
            rows = stock_data.get_stock_price_history('TEST', auto_predict=True, include_market_cap=False)
        rows = [row for row in rows if 'Date' in row]
        self.assertTrue(all(row['Label'] is None for row in rows[-22:]))
        self.assertIsNotNone(rows[-23]['Label'])
        # Tag rows with their original bar index to inspect the actual split.
        for index, row in enumerate(rows):
            row['Week_Price_Range'] = index

        model = RandomForestClassifier(n_estimators=2, random_state=42)
        with patch('sklearn.ensemble.RandomForestClassifier', return_value=model), \
             patch.object(model, 'fit', wraps=model.fit) as fit, \
             patch.object(model, 'predict', wraps=model.predict) as predict, \
             patch.object(sys, 'stderr', io.StringIO()):
            result = stock_data.train_random_forest_model(rows)
        self.assertNotIn('error', result)
        feature_index = result['model_data']['feature_names'].index('Week_Price_Range')
        last_train_bar = int(fit.call_args.args[0][-1, feature_index])
        first_test_bar = int(predict.call_args_list[-1].args[0][0, feature_index])
        self.assertLess(rows[last_train_bar + 22]['Date'], rows[first_test_bar]['Date'])


class ModelCacheTest(unittest.TestCase):
    def test_cache_is_atomic_distinct_and_recovers_from_bad_entries(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(stock_data, 'MODEL_CACHE_DIR', directory), \
             patch.object(stock_data, '_model_cache', {}):
            self.assertNotEqual(stock_data._get_cache_path('BRK.B'), stock_data._get_cache_path('BRKB'))
            entry = {'model_data': {'status': 'success'}, 'trained_at': datetime.now()}
            stock_data._save_model_to_disk('TEST', entry)
            self.assertEqual(stock_data._get_cached_model('test'), entry['model_data'])
            model_status = next(route.endpoint for route in stock_data.app.routes if route.path == '/model/status/{symbol}')
            self.assertTrue(model_status('TEST')['cached'])
            with patch.object(stock_data.pickle, 'dump', side_effect=OSError('disk full')), \
                 patch.object(sys, 'stderr', io.StringIO()):
                stock_data._save_model_to_disk('TEST', {'replacement': True})
            self.assertEqual(stock_data._load_model_from_disk('TEST'), entry)
            self.assertEqual(len(os.listdir(directory)), 1)
            for bad in ({}, {'trained_at': 'invalid'}, {'trained_at': datetime.now() - timedelta(days=1)}):
                stock_data._model_cache.clear()
                stock_data._save_model_to_disk('TEST', bad)
                self.assertIsNone(stock_data._get_cached_model('TEST'))
                self.assertFalse(model_status('TEST')['cached'])
            with patch.object(stock_data.os, 'makedirs', side_effect=PermissionError('read only')), \
                 patch.object(sys, 'stderr', io.StringIO()):
                stock_data._set_cached_model('MEMORY', entry['model_data'])
            self.assertEqual(stock_data._get_cached_model('MEMORY'), entry['model_data'])


if __name__ == '__main__':
    unittest.main()
