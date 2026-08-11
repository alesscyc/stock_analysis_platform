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


if __name__ == '__main__':
    unittest.main()
