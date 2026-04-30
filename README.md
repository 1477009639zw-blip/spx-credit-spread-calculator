# SPX 0DTE Backtester

本项目是一个本地 SPX 0DTE 期权策略回测工具。第一版使用 Streamlit 作为 Web 界面，Python 策略类表达交易规则，回测引擎用分钟级 SPX、VIX1D 和 SPX 期权数据计算结果。

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Run Tests

```bash
pytest
```

## Run Web App

```bash
streamlit run app/app.py
```

## Data Schemas

SPX/VIX1D minute files:

```csv
timestamp,symbol,open,high,low,close
2024-01-03 09:30:00,SPX,4510,4512,4508,4510
```

Option minute files:

```csv
timestamp,expiry,right,strike,bid,ask
2024-01-03 09:31:00,2024-01-03,P,4500,10,12
```

If `mid` is missing, the loader computes `(bid + ask) / 2`.

## Strategy API

Strategies subclass `strategies.base.BaseStrategy` and implement `generate_trade(context)`. The context includes:

- `prior_spx_close`
- `prior_vix1d_close`
- `open_price`
- `open_gap`
- `open_gap_pct`

The example strategy in `strategies/example_gap_strategy.py` returns a strict 0DTE multi-leg option plan.

