from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

import pandas as pd

from backtest.data import (
    get_session,
    previous_trading_day_close,
    regular_trading_days,
    timestamp_at_or_after,
    timestamp_at_or_before,
)
from backtest.models import BacktestResult, OptionLeg, StrategyContext, TradePlan, TradeRecord
from strategies.base import BaseStrategy


class BacktestEngine:
    def __init__(
        self,
        spx_minutes: pd.DataFrame,
        option_minutes: pd.DataFrame,
        vix1d_minutes: pd.DataFrame,
        strategy: BaseStrategy,
    ) -> None:
        self.spx_minutes = spx_minutes.copy()
        self.option_minutes = option_minutes.copy()
        self.vix1d_minutes = vix1d_minutes.copy()
        self.strategy = strategy

    def run(self, start_date: Optional[date] = None, end_date: Optional[date] = None) -> BacktestResult:
        records: List[TradeRecord] = []
        skipped: List[Dict[str, str]] = []

        for day in regular_trading_days(self.spx_minutes):
            if start_date and day < start_date:
                continue
            if end_date and day > end_date:
                continue

            try:
                record = self._run_day(day)
            except Exception as exc:
                skipped.append({"trade_date": day.isoformat(), "reason": type(exc).__name__, "detail": str(exc)})
                continue

            if record is None:
                skipped.append({"trade_date": day.isoformat(), "reason": "no_trade", "detail": "Strategy returned no plan."})
            else:
                records.append(record)

        trades = pd.DataFrame([record.to_dict() for record in records])
        skipped_days = pd.DataFrame(skipped, columns=["trade_date", "reason", "detail"])
        return _build_result(trades, skipped_days)

    def _run_day(self, day: date) -> Optional[TradeRecord]:
        spx_day = get_session(self.spx_minutes, day)
        if spx_day.empty:
            raise ValueError("No SPX minute data for trading day.")

        prior_spx_close = previous_trading_day_close(self.spx_minutes, day)
        if prior_spx_close is None:
            raise ValueError("missing_prior_spx_close")

        prior_vix1d_close = previous_trading_day_close(self.vix1d_minutes, day)
        if prior_vix1d_close is None:
            raise ValueError("missing_prior_vix1d_close")

        context = self.strategy.prepare_context(day, spx_day, prior_spx_close, prior_vix1d_close)
        plan = self.strategy.generate_trade(context)
        if plan is None:
            return None
        plan = plan.with_0dte_expiry(day)
        return self._execute_plan(day, context, plan, spx_day)

    def _execute_plan(
        self,
        day: date,
        context: StrategyContext,
        plan: TradePlan,
        spx_day: pd.DataFrame,
    ) -> TradeRecord:
        options_day = self.option_minutes.loc[
            (self.option_minutes["trade_date"] == day) & (self.option_minutes["expiry"] == day)
        ].copy()
        if options_day.empty:
            raise ValueError("missing_0dte_option_data")

        entry_ts = timestamp_at_or_after(spx_day, plan.entry_time)
        if entry_ts is None:
            raise ValueError(f"No SPX timestamp at or after entry_time={plan.entry_time}.")
        exit_deadline = timestamp_at_or_before(spx_day, plan.exit_time)
        if exit_deadline is None or exit_deadline < entry_ts:
            raise ValueError(f"No valid SPX exit timestamp at or before exit_time={plan.exit_time}.")

        leg_quotes = self._build_leg_quote_frame(options_day, plan.legs)
        timeline = leg_quotes.loc[(leg_quotes.index >= entry_ts) & (leg_quotes.index <= exit_deadline)].dropna(how="any")
        if timeline.empty or entry_ts not in timeline.index:
            raise ValueError("missing_entry_quote")

        spx_timeline = spx_day.set_index("timestamp")[["open", "high", "low", "close"]]
        timeline = timeline.join(spx_timeline, how="inner")
        if timeline.empty:
            raise ValueError("No overlapping SPX and option timestamps for trade.")

        entry_prices = _price_dict(timeline.loc[entry_ts], plan.legs)
        entry_value = _position_value(timeline.loc[entry_ts], plan.legs)
        exit_ts = timeline.index[-1]
        exit_reason = "eod"
        max_unrealized_profit = 0.0
        max_unrealized_loss = 0.0

        for ts, row in timeline.loc[timeline.index >= entry_ts].iterrows():
            pnl = _position_value(row, plan.legs) - entry_value
            max_unrealized_profit = max(max_unrealized_profit, pnl)
            max_unrealized_loss = min(max_unrealized_loss, pnl)

            reason = _exit_reason(row, pnl, plan)
            if reason:
                exit_ts = ts
                exit_reason = reason
                break

        exit_row = timeline.loc[exit_ts]
        exit_prices = _price_dict(exit_row, plan.legs)
        exit_value = _position_value(exit_row, plan.legs)

        return TradeRecord(
            trade_date=day,
            entry_time=entry_ts,
            exit_time=exit_ts,
            exit_reason=exit_reason,
            legs=[leg.to_dict() for leg in plan.legs],
            entry_prices=entry_prices,
            exit_prices=exit_prices,
            entry_value=round(entry_value, 2),
            exit_value=round(exit_value, 2),
            pnl=round(exit_value - entry_value, 2),
            max_unrealized_profit=round(max_unrealized_profit, 2),
            max_unrealized_loss=round(max_unrealized_loss, 2),
            prior_spx_close=context.prior_spx_close,
            prior_vix1d_close=context.prior_vix1d_close,
            open_price=context.open_price,
            open_gap=context.open_gap,
            open_gap_pct=context.open_gap_pct,
            metadata=plan.metadata,
        )

    def _build_leg_quote_frame(self, options_day: pd.DataFrame, legs: List[OptionLeg]) -> pd.DataFrame:
        frames = []
        for leg in legs:
            match = options_day.loc[
                (options_day["right"] == leg.right)
                & (options_day["strike"] == leg.strike)
                & (options_day["expiry"] == leg.expiry)
            ].copy()
            if match.empty:
                raise ValueError(f"missing_contract: {leg.key()}")
            series = match.sort_values("timestamp").set_index("timestamp")["mid"].rename(leg.key())
            frames.append(series)
        return pd.concat(frames, axis=1).sort_index()


def _exit_reason(row: pd.Series, pnl: float, plan: TradePlan) -> Optional[str]:
    if plan.profit_target is not None and pnl >= plan.profit_target:
        return "profit_target"
    if plan.stop_loss is not None and pnl <= -abs(plan.stop_loss):
        return "stop_loss"
    if plan.spx_upper_exit is not None and float(row["high"]) >= plan.spx_upper_exit:
        return "spx_upper_exit"
    if plan.spx_lower_exit is not None and float(row["low"]) <= plan.spx_lower_exit:
        return "spx_lower_exit"
    return None


def _price_dict(row: pd.Series, legs: List[OptionLeg]) -> Dict[str, float]:
    return {leg.key(): round(float(row[leg.key()]), 4) for leg in legs}


def _position_value(row: pd.Series, legs: List[OptionLeg]) -> float:
    value = 0.0
    for leg in legs:
        value += leg.signed_quantity * float(row[leg.key()]) * leg.multiplier
    return value


def _build_result(trades: pd.DataFrame, skipped_days: pd.DataFrame) -> BacktestResult:
    if trades.empty:
        empty = pd.DataFrame()
        return BacktestResult(
            trades=trades,
            skipped_days=skipped_days,
            equity_curve=empty,
            summary={
                "trades": 0,
                "total_pnl": 0.0,
                "win_rate": 0.0,
                "average_pnl": 0.0,
                "max_drawdown": 0.0,
            },
            by_month=empty,
            by_gap_bucket=empty,
            by_vix_bucket=empty,
        )

    out = trades.copy()
    out["exit_time"] = pd.to_datetime(out["exit_time"])
    out = out.sort_values("exit_time").reset_index(drop=True)
    out["cumulative_pnl"] = out["pnl"].cumsum()
    out["running_peak"] = out["cumulative_pnl"].cummax()
    out["drawdown"] = out["cumulative_pnl"] - out["running_peak"]

    equity_curve = out[["exit_time", "pnl", "cumulative_pnl", "drawdown"]].copy()
    summary = {
        "trades": int(len(out)),
        "total_pnl": round(float(out["pnl"].sum()), 2),
        "win_rate": round(float((out["pnl"] > 0).mean()), 4),
        "average_pnl": round(float(out["pnl"].mean()), 2),
        "max_drawdown": round(float(out["drawdown"].min()), 2),
    }

    exit_time_for_month = out["exit_time"]
    if exit_time_for_month.dt.tz is not None:
        exit_time_for_month = exit_time_for_month.dt.tz_localize(None)

    by_month = (
        out.assign(month=exit_time_for_month.dt.to_period("M").astype(str))
        .groupby("month", as_index=False)
        .agg(trades=("pnl", "size"), pnl=("pnl", "sum"), win_rate=("pnl", lambda s: (s > 0).mean()))
    )
    by_gap_bucket = _bucket_stats(out, "open_gap_pct", [-999, -0.01, -0.005, 0, 0.005, 0.01, 999])
    by_vix_bucket = _bucket_stats(out, "prior_vix1d_close", [0, 10, 15, 20, 30, 50, 999])

    return BacktestResult(
        trades=out,
        skipped_days=skipped_days,
        equity_curve=equity_curve,
        summary=summary,
        by_month=by_month,
        by_gap_bucket=by_gap_bucket,
        by_vix_bucket=by_vix_bucket,
    )


def _bucket_stats(df: pd.DataFrame, column: str, bins: List[float]) -> pd.DataFrame:
    labels = [f"{bins[i]:g} to {bins[i + 1]:g}" for i in range(len(bins) - 1)]
    bucketed = df.assign(bucket=pd.cut(df[column], bins=bins, labels=labels, include_lowest=True))
    return (
        bucketed.groupby("bucket", observed=False)
        .agg(trades=("pnl", "size"), pnl=("pnl", "sum"), win_rate=("pnl", lambda s: (s > 0).mean()))
        .reset_index()
    )
