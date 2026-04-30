from __future__ import annotations

from pathlib import Path

from backtest.data import load_option_data, load_price_data
from backtest.engine import BacktestEngine
from strategies import ExampleGapStrategy


FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture_data():
    spx = load_price_data(FIXTURES / "spx_minutes.csv", symbol="SPX")
    vix = load_price_data(FIXTURES / "vix1d_minutes.csv", symbol="VIX1D")
    options = load_option_data(FIXTURES / "options_minutes.csv")
    return spx, vix, options


def test_profit_target_uses_prior_context_0dte_and_mid_prices():
    spx, vix, options = load_fixture_data()
    strategy = ExampleGapStrategy(
        short_offset=10,
        long_offset=20,
        profit_target=100,
        stop_loss=1000,
        spx_stop_offset=None,
    )

    result = BacktestEngine(spx, options, vix, strategy).run()

    trade = result.trades.iloc[0]
    assert result.summary["trades"] == 1
    assert trade["prior_spx_close"] == 4500
    assert trade["prior_vix1d_close"] == 13
    assert trade["open_gap"] == 10
    assert trade["entry_prices"]["SELL_1_P_4500_2024-01-03"] == 11
    assert trade["entry_prices"]["BUY_1_P_4490_2024-01-03"] == 8
    assert trade["exit_reason"] == "profit_target"
    assert trade["pnl"] == 100


def test_spx_price_trigger_can_exit_trade():
    spx, vix, options = load_fixture_data()
    strategy = ExampleGapStrategy(
        short_offset=10,
        long_offset=20,
        profit_target=None,
        stop_loss=None,
        spx_stop_offset=5,
    )

    result = BacktestEngine(spx, options, vix, strategy).run()

    trade = result.trades.iloc[0]
    assert trade["exit_reason"] == "spx_lower_exit"
    assert trade["pnl"] == 100


def test_eod_exit_when_no_risk_rule_triggers():
    spx, vix, options = load_fixture_data()
    strategy = ExampleGapStrategy(
        short_offset=10,
        long_offset=20,
        profit_target=None,
        stop_loss=None,
        spx_stop_offset=None,
    )

    result = BacktestEngine(spx, options, vix, strategy).run()

    trade = result.trades.iloc[0]
    assert trade["exit_reason"] == "eod"
    assert trade["pnl"] == -100


def test_missing_prior_vix_is_recorded_as_skipped_day():
    spx, _, options = load_fixture_data()
    vix = load_price_data(FIXTURES / "vix1d_minutes.csv", symbol="VIX1D")
    vix = vix[vix["trade_date"].astype(str) == "2024-01-03"]
    strategy = ExampleGapStrategy(short_offset=10, long_offset=20)

    result = BacktestEngine(spx, options, vix, strategy).run()

    assert result.trades.empty
    assert "missing_prior_vix1d_close" in result.skipped_days.iloc[-1]["detail"]


def test_missing_contract_is_recorded_as_skipped_day():
    spx, vix, options = load_fixture_data()
    strategy = ExampleGapStrategy(short_offset=15, long_offset=20)

    result = BacktestEngine(spx, options, vix, strategy).run()

    assert result.trades.empty
    assert result.skipped_days.iloc[-1]["reason"] == "ValueError"
    assert "missing_contract" in result.skipped_days.iloc[-1]["detail"]

