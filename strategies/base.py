from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date
from typing import Optional

import pandas as pd

from backtest.models import StrategyContext, TradePlan


class BaseStrategy(ABC):
    def prepare_context(
        self,
        day: date,
        spx_day: pd.DataFrame,
        prior_spx_close: float,
        prior_vix1d_close: float,
    ) -> StrategyContext:
        if spx_day.empty:
            raise ValueError("Cannot prepare strategy context from empty SPX session.")
        open_price = float(spx_day.sort_values("timestamp").iloc[0]["open"])
        open_gap = open_price - float(prior_spx_close)
        open_gap_pct = open_gap / float(prior_spx_close)
        return StrategyContext(
            trade_date=day,
            prior_spx_close=float(prior_spx_close),
            prior_vix1d_close=float(prior_vix1d_close),
            open_price=open_price,
            open_gap=open_gap,
            open_gap_pct=open_gap_pct,
        )

    @abstractmethod
    def generate_trade(self, context: StrategyContext) -> Optional[TradePlan]:
        """Return a trade plan for the day, or None to skip."""

