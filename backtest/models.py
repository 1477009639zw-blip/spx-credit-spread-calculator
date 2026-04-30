from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional

import pandas as pd


VALID_RIGHTS = {"C", "CALL", "P", "PUT"}
VALID_SIDES = {"BUY", "SELL"}


def normalize_right(right: str) -> str:
    value = str(right).strip().upper()
    if value not in VALID_RIGHTS:
        raise ValueError(f"Invalid option right: {right!r}. Expected C/CALL/P/PUT.")
    return "C" if value in {"C", "CALL"} else "P"


def normalize_side(side: str) -> str:
    value = str(side).strip().upper()
    if value not in VALID_SIDES:
        raise ValueError(f"Invalid option side: {side!r}. Expected BUY or SELL.")
    return value


def format_strike(strike: float) -> str:
    value = float(strike)
    if value.is_integer():
        return str(int(value))
    return f"{value:g}"


@dataclass(frozen=True)
class OptionLeg:
    right: str
    strike: float
    side: str
    quantity: int = 1
    expiry: Optional[date] = None
    multiplier: int = 100

    def __post_init__(self) -> None:
        object.__setattr__(self, "right", normalize_right(self.right))
        object.__setattr__(self, "side", normalize_side(self.side))
        object.__setattr__(self, "strike", float(self.strike))
        if self.quantity <= 0:
            raise ValueError("OptionLeg quantity must be positive.")
        if self.multiplier <= 0:
            raise ValueError("OptionLeg multiplier must be positive.")

    @property
    def signed_quantity(self) -> int:
        return self.quantity if self.side == "BUY" else -self.quantity

    def with_expiry(self, expiry: date) -> "OptionLeg":
        if self.expiry is not None and self.expiry != expiry:
            raise ValueError(
                f"Only 0DTE legs are supported. Leg expiry {self.expiry} does not match trade date {expiry}."
            )
        return OptionLeg(
            right=self.right,
            strike=self.strike,
            side=self.side,
            quantity=self.quantity,
            expiry=expiry,
            multiplier=self.multiplier,
        )

    def key(self) -> str:
        expiry = self.expiry.isoformat() if self.expiry else "0DTE"
        return f"{self.side}_{self.quantity}_{self.right}_{format_strike(self.strike)}_{expiry}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "side": self.side,
            "quantity": self.quantity,
            "right": self.right,
            "strike": self.strike,
            "expiry": self.expiry.isoformat() if self.expiry else None,
            "multiplier": self.multiplier,
        }


@dataclass(frozen=True)
class StrategyContext:
    trade_date: date
    prior_spx_close: float
    prior_vix1d_close: float
    open_price: float
    open_gap: float
    open_gap_pct: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "trade_date": self.trade_date.isoformat(),
            "prior_spx_close": self.prior_spx_close,
            "prior_vix1d_close": self.prior_vix1d_close,
            "open_price": self.open_price,
            "open_gap": self.open_gap,
            "open_gap_pct": self.open_gap_pct,
        }


@dataclass(frozen=True)
class TradePlan:
    legs: List[OptionLeg]
    entry_time: str = "09:31"
    exit_time: str = "15:55"
    profit_target: Optional[float] = None
    stop_loss: Optional[float] = None
    spx_upper_exit: Optional[float] = None
    spx_lower_exit: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.legs:
            raise ValueError("TradePlan must include at least one option leg.")
        if self.profit_target is not None and self.profit_target <= 0:
            raise ValueError("profit_target must be positive when provided.")
        if self.stop_loss is not None and self.stop_loss <= 0:
            raise ValueError("stop_loss must be positive when provided.")

    def with_0dte_expiry(self, trade_date: date) -> "TradePlan":
        return TradePlan(
            legs=[leg.with_expiry(trade_date) for leg in self.legs],
            entry_time=self.entry_time,
            exit_time=self.exit_time,
            profit_target=self.profit_target,
            stop_loss=self.stop_loss,
            spx_upper_exit=self.spx_upper_exit,
            spx_lower_exit=self.spx_lower_exit,
            metadata=dict(self.metadata),
        )


@dataclass
class TradeRecord:
    trade_date: date
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    exit_reason: str
    legs: List[Dict[str, Any]]
    entry_prices: Dict[str, float]
    exit_prices: Dict[str, float]
    entry_value: float
    exit_value: float
    pnl: float
    max_unrealized_profit: float
    max_unrealized_loss: float
    prior_spx_close: float
    prior_vix1d_close: float
    open_price: float
    open_gap: float
    open_gap_pct: float
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "trade_date": self.trade_date.isoformat(),
            "entry_time": self.entry_time.isoformat(),
            "exit_time": self.exit_time.isoformat(),
            "exit_reason": self.exit_reason,
            "legs": self.legs,
            "entry_prices": self.entry_prices,
            "exit_prices": self.exit_prices,
            "entry_value": self.entry_value,
            "exit_value": self.exit_value,
            "pnl": self.pnl,
            "max_unrealized_profit": self.max_unrealized_profit,
            "max_unrealized_loss": self.max_unrealized_loss,
            "prior_spx_close": self.prior_spx_close,
            "prior_vix1d_close": self.prior_vix1d_close,
            "open_price": self.open_price,
            "open_gap": self.open_gap,
            "open_gap_pct": self.open_gap_pct,
            "metadata": self.metadata,
        }


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    skipped_days: pd.DataFrame
    equity_curve: pd.DataFrame
    summary: Dict[str, Any]
    by_month: pd.DataFrame
    by_gap_bucket: pd.DataFrame
    by_vix_bucket: pd.DataFrame

