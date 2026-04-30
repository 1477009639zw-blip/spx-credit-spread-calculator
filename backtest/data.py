from __future__ import annotations

from datetime import date, time
from pathlib import Path
from typing import BinaryIO, Iterable, Optional, Union

import pandas as pd


DEFAULT_TZ = "America/New_York"
REGULAR_SESSION_START = time(9, 30)
REGULAR_SESSION_END = time(16, 0)

Source = Union[str, Path, BinaryIO]


class DataValidationError(ValueError):
    pass


def load_price_data(source: Source, symbol: Optional[str] = None, timezone: str = DEFAULT_TZ) -> pd.DataFrame:
    df = _read_table(source)
    df = _normalize_columns(df)
    _require_columns(df, {"timestamp", "open", "high", "low", "close"}, "price data")
    if "symbol" not in df.columns:
        df["symbol"] = symbol or "UNKNOWN"
    elif symbol:
        df["symbol"] = df["symbol"].fillna(symbol)

    df = _normalize_timestamp(df, timezone)
    for column in ["open", "high", "low", "close"]:
        df[column] = pd.to_numeric(df[column], errors="raise")

    return _regular_session(df).sort_values("timestamp").reset_index(drop=True)


def load_option_data(source: Source, timezone: str = DEFAULT_TZ) -> pd.DataFrame:
    df = _read_table(source)
    df = _normalize_columns(df)
    _require_columns(df, {"timestamp", "expiry", "right", "strike", "bid", "ask"}, "option data")

    df = _normalize_timestamp(df, timezone)
    df["expiry"] = pd.to_datetime(df["expiry"], errors="raise").dt.date
    df["right"] = df["right"].astype(str).str.strip().str.upper()
    df["right"] = df["right"].replace({"CALL": "C", "PUT": "P"})
    invalid_rights = sorted(set(df["right"]) - {"C", "P"})
    if invalid_rights:
        raise DataValidationError(f"Invalid option right values: {invalid_rights}. Expected C/P/CALL/PUT.")

    for column in ["strike", "bid", "ask"]:
        df[column] = pd.to_numeric(df[column], errors="raise")
    if "mid" in df.columns:
        df["mid"] = pd.to_numeric(df["mid"], errors="coerce")
        df["mid"] = df["mid"].fillna((df["bid"] + df["ask"]) / 2.0)
    else:
        df["mid"] = (df["bid"] + df["ask"]) / 2.0

    return _regular_session(df).sort_values("timestamp").reset_index(drop=True)


def get_session(df: pd.DataFrame, day: date) -> pd.DataFrame:
    return df.loc[df["trade_date"] == day].sort_values("timestamp").reset_index(drop=True)


def previous_trading_day_close(df: pd.DataFrame, day: date) -> Optional[float]:
    prior_days = sorted(d for d in df["trade_date"].dropna().unique() if d < day)
    if not prior_days:
        return None
    prior_session = get_session(df, prior_days[-1])
    if prior_session.empty:
        return None
    return float(prior_session.iloc[-1]["close"])


def regular_trading_days(df: pd.DataFrame) -> Iterable[date]:
    return sorted(df["trade_date"].dropna().unique())


def parse_clock(value: str) -> time:
    try:
        parsed = pd.to_datetime(value, format="%H:%M")
    except ValueError as exc:
        raise ValueError(f"Invalid clock time {value!r}; expected HH:MM.") from exc
    return parsed.time()


def timestamp_at_or_after(df: pd.DataFrame, clock: str) -> Optional[pd.Timestamp]:
    target = parse_clock(clock)
    candidates = df.loc[df["timestamp"].dt.time >= target, "timestamp"]
    if candidates.empty:
        return None
    return candidates.iloc[0]


def timestamp_at_or_before(df: pd.DataFrame, clock: str) -> Optional[pd.Timestamp]:
    target = parse_clock(clock)
    candidates = df.loc[df["timestamp"].dt.time <= target, "timestamp"]
    if candidates.empty:
        return None
    return candidates.iloc[-1]


def _read_table(source: Source) -> pd.DataFrame:
    name = str(getattr(source, "name", source)).lower()
    if hasattr(source, "seek"):
        source.seek(0)
    if name.endswith(".parquet"):
        return pd.read_parquet(source)
    if name.endswith(".csv") or "." not in Path(name).name:
        return pd.read_csv(source)
    raise DataValidationError(f"Unsupported file type for {name!r}. Use CSV or Parquet.")


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = [str(column).strip().lower() for column in out.columns]
    return out


def _require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = sorted(required - set(df.columns))
    if missing:
        raise DataValidationError(f"Missing required columns in {label}: {missing}")


def _normalize_timestamp(df: pd.DataFrame, timezone: str) -> pd.DataFrame:
    out = df.copy()
    ts = pd.to_datetime(out["timestamp"], errors="raise")
    if ts.dt.tz is None:
        ts = ts.dt.tz_localize(timezone)
    else:
        ts = ts.dt.tz_convert(timezone)
    out["timestamp"] = ts
    out["trade_date"] = out["timestamp"].dt.date
    return out


def _regular_session(df: pd.DataFrame) -> pd.DataFrame:
    local_time = df["timestamp"].dt.time
    mask = (local_time >= REGULAR_SESSION_START) & (local_time <= REGULAR_SESSION_END)
    return df.loc[mask].copy()

