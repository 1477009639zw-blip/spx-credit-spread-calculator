from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from backtest.models import OptionLeg, StrategyContext, TradePlan
from strategies.base import BaseStrategy


@dataclass
class ExampleGapStrategy(BaseStrategy):
    entry_time: str = "09:31"
    exit_time: str = "15:55"
    strike_step: float = 5.0
    short_offset: float = 25.0
    long_offset: float = 50.0
    quantity: int = 1
    min_abs_gap_pct: float = 0.0
    profit_target: Optional[float] = 150.0
    stop_loss: Optional[float] = 300.0
    spx_stop_offset: Optional[float] = 35.0

    def generate_trade(self, context: StrategyContext) -> Optional[TradePlan]:
        if abs(context.open_gap_pct) < self.min_abs_gap_pct:
            return None

        if context.open_gap >= 0:
            short_strike = _round_to_step(context.open_price - self.short_offset, self.strike_step)
            long_strike = _round_to_step(context.open_price - self.long_offset, self.strike_step)
            legs = [
                OptionLeg(right="P", strike=short_strike, side="SELL", quantity=self.quantity),
                OptionLeg(right="P", strike=long_strike, side="BUY", quantity=self.quantity),
            ]
            spx_lower_exit = (
                context.open_price - self.spx_stop_offset if self.spx_stop_offset is not None else None
            )
            spx_upper_exit = None
            direction = "bull_put_spread"
        else:
            short_strike = _round_to_step(context.open_price + self.short_offset, self.strike_step)
            long_strike = _round_to_step(context.open_price + self.long_offset, self.strike_step)
            legs = [
                OptionLeg(right="C", strike=short_strike, side="SELL", quantity=self.quantity),
                OptionLeg(right="C", strike=long_strike, side="BUY", quantity=self.quantity),
            ]
            spx_upper_exit = (
                context.open_price + self.spx_stop_offset if self.spx_stop_offset is not None else None
            )
            spx_lower_exit = None
            direction = "bear_call_spread"

        return TradePlan(
            legs=legs,
            entry_time=self.entry_time,
            exit_time=self.exit_time,
            profit_target=self.profit_target,
            stop_loss=self.stop_loss,
            spx_upper_exit=spx_upper_exit,
            spx_lower_exit=spx_lower_exit,
            metadata={
                "strategy": self.__class__.__name__,
                "direction": direction,
                "open_gap": context.open_gap,
                "open_gap_pct": context.open_gap_pct,
            },
        )


def _round_to_step(value: float, step: float) -> float:
    if step <= 0:
        raise ValueError("strike_step must be positive.")
    return round(value / step) * step

