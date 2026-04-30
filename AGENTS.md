# AGENTS.md

This project is a local research backtester for SPX 0DTE minute-level option strategies.

## Working Rules

- Treat raw market data as read-only. Do not modify user-provided CSV or Parquet files.
- The default execution model is research-only mid-price fills. Do not add bid/ask execution, commissions, margin, assignment, or settlement modeling unless explicitly requested.
- Put strategy rules in `strategies/`; keep the reusable backtest engine in `backtest/`.
- New engine behavior should include a small fixture-based test in `tests/`.
- Prefer explicit failures for missing market data or missing option contracts. Do not silently substitute nearby strikes or expiries.

## Data Contract

- SPX and VIX1D minute data should provide `timestamp`, `symbol`, `open`, `high`, `low`, `close`.
- Option minute data should provide `timestamp`, `expiry`, `right`, `strike`, `bid`, `ask`, and optionally `mid`.
- Timestamps are interpreted as `America/New_York` when timezone-naive.

