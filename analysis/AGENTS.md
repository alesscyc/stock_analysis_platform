# ANALYSIS — Python ML Engine

## OVERVIEW
Monolithic Python script: fetches stock data via yfinance, computes 16 technical indicators, trains RandomForest classifier, outputs predictions. All in one 460-line file.

## STRUCTURE
```
analysis/
├── stock_data.py         # 460 lines — everything
└── stock_rf_model.pkl    # Trained model (pickle, written to CWD)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Data fetch + indicators | `stock_data.py` | `get_stock_price_history()` — yfinance + 16 indicators |
| RF model training | `stock_data.py` | `train_random_forest_model()` — sklearn RandomForest |
| Prediction | `stock_data.py` | `predict_stock_recommendation()` |
| CLI dispatch | `stock_data.py` | `__main__` — routes `sys.argv[1]` to functions |

## CONVENTIONS
- **Pure JSON stdout**: ALL output must be valid JSON. No `print()` for debugging — breaks `execFile` parser in backend.
- **CLI interface**: `python stock_data.py <function_name> <symbol> [date_range] [interval] [auto_predict]`.
- **Model persistence**: `stock_rf_model.pkl` via pickle. Written to CWD (not a fixed path).
- **Training params**: `n_estimators=100, max_depth=10, min_samples_split=20, min_samples_leaf=10, class_weight='balanced'`, `random_state=42`.
- **BUY label**: `future_return > 0.01` (1% threshold).
- **Min training data**: 50 complete records required. Samples up to 300.
- **Dependencies**: yfinance, pandas, numpy, scikit-learn, ta (technical analysis library). No `requirements.txt` exists.

## KEY ANTI-PATTERNS & RISKS
- **Retrained every request**: `auto_predict=true` trains a fresh RF model each call — expensive, non-deterministic, race condition risk with `.pkl` writes.
- **Pickle to CWD**: Model location depends on working directory. Copies end up in both `backend/` and `analysis/`.
- **No requirements.txt**: README references one but it doesn't exist. Install manually: `pip install yfinance pandas numpy scikit-learn ta`.
- **Monolithic**: Single file handles data fetch, feature engineering, training, prediction, and CLI. No separation of concerns.
- **No error boundaries**: yfinance network errors propagate as unstructured exceptions — backend gets non-JSON stderr.
- **JSON on stdout only**: Any debug print or stray output breaks the backend parser. Use `sys.stderr` exclusively for logging.

## COMMANDS
```bash
# Fetch data + indicators
python stock_data.py get_stock_price_history AAPL 1y 1d true

# Train model only
python stock_data.py train_random_forest_model AAPL 1y 1d

# Predict
python stock_data.py predict_stock_recommendation AAPL 1y 1d
```

## TECHNICAL INDICATORS (16)
SMA(5,10,20,50), EMA(12,26), RSI(14), MACD + signal + histogram, Bollinger Bands (upper/mid/lower), ATR(14), OBV, Stochastic %K.
