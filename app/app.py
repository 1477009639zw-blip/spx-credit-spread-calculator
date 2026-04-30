from __future__ import annotations

from datetime import date
from pathlib import Path
import sys
from typing import Optional

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backtest.data import DataValidationError, load_option_data, load_price_data
from backtest.engine import BacktestEngine
from strategies import ExampleGapStrategy


st.set_page_config(page_title="SPX 0DTE Backtester", layout="wide")


def main() -> None:
    st.title("SPX 0DTE 期权策略回测")
    st.caption("本地 CSV/Parquet 数据，Python 策略类，mid 价研究口径。")

    with st.sidebar:
        st.header("数据")
        source_mode = st.radio("输入方式", ["本地路径", "上传文件"], horizontal=True)
        sources = _data_sources(source_mode)

        st.header("策略参数")
        entry_time = st.text_input("入场时间", "09:31")
        exit_time = st.text_input("最晚出场时间", "15:55")
        strike_step = st.number_input("行权价步长", min_value=1.0, value=5.0, step=1.0)
        short_offset = st.number_input("卖方腿离开盘点数", min_value=0.0, value=25.0, step=5.0)
        long_offset = st.number_input("买方腿离开盘点数", min_value=0.0, value=50.0, step=5.0)
        quantity = st.number_input("每腿张数", min_value=1, value=1, step=1)
        min_abs_gap_pct = st.number_input("最小绝对 gap 百分比", min_value=0.0, value=0.0, step=0.001, format="%.4f")
        profit_target = _optional_number("组合止盈金额", 150.0)
        stop_loss = _optional_number("组合止损金额", 300.0)
        spx_stop_offset = _optional_number("SPX 触发点数", 35.0)

        st.header("日期")
        use_dates = st.checkbox("限制日期范围", value=False)
        start_date = st.date_input("开始日期", value=date.today()) if use_dates else None
        end_date = st.date_input("结束日期", value=date.today()) if use_dates else None

        run = st.button("运行回测", type="primary")

    if not run:
        _render_help()
        return

    try:
        spx, vix1d, options = _load_inputs(sources)
        strategy = ExampleGapStrategy(
            entry_time=entry_time,
            exit_time=exit_time,
            strike_step=strike_step,
            short_offset=short_offset,
            long_offset=long_offset,
            quantity=int(quantity),
            min_abs_gap_pct=min_abs_gap_pct,
            profit_target=profit_target,
            stop_loss=stop_loss,
            spx_stop_offset=spx_stop_offset,
        )
        result = BacktestEngine(spx, options, vix1d, strategy).run(start_date=start_date, end_date=end_date)
    except (DataValidationError, ValueError, FileNotFoundError) as exc:
        st.error(str(exc))
        return

    _render_result(result)


def _data_sources(source_mode: str) -> dict:
    if source_mode == "本地路径":
        return {
            "spx": st.text_input("SPX 分钟线路径", placeholder="/path/to/spx.csv"),
            "vix1d": st.text_input("VIX1D 分钟线路径", placeholder="/path/to/vix1d.parquet"),
            "options": st.text_input("SPX 期权分钟线路径", placeholder="/path/to/options.parquet"),
        }
    return {
        "spx": st.file_uploader("上传 SPX 分钟线", type=["csv", "parquet"]),
        "vix1d": st.file_uploader("上传 VIX1D 分钟线", type=["csv", "parquet"]),
        "options": st.file_uploader("上传 SPX 期权分钟线", type=["csv", "parquet"]),
    }


def _optional_number(label: str, default: Optional[float]) -> Optional[float]:
    enabled = st.checkbox(f"启用 {label}", value=default is not None)
    if not enabled:
        return None
    return st.number_input(label, min_value=0.01, value=float(default or 1.0), step=25.0)


def _load_inputs(sources: dict) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    missing = [name for name, source in sources.items() if not source]
    if missing:
        raise ValueError(f"Missing data inputs: {missing}")
    spx = load_price_data(sources["spx"], symbol="SPX")
    vix1d = load_price_data(sources["vix1d"], symbol="VIX1D")
    options = load_option_data(sources["options"])
    return spx, vix1d, options


def _render_help() -> None:
    st.subheader("使用方式")
    st.write("在左侧选择本地文件或上传 CSV/Parquet，设置示例策略参数后运行。")
    st.write("真实策略可通过继承 `strategies.base.BaseStrategy` 并替换 `ExampleGapStrategy` 接入。")

    st.subheader("数据字段")
    st.code("SPX/VIX1D: timestamp,symbol,open,high,low,close", language="text")
    st.code("Options: timestamp,expiry,right,strike,bid,ask[,mid]", language="text")


def _render_result(result) -> None:
    summary = result.summary
    cols = st.columns(5)
    cols[0].metric("交易数", summary["trades"])
    cols[1].metric("总 PnL", f'{summary["total_pnl"]:,.2f}')
    cols[2].metric("胜率", f'{summary["win_rate"]:.2%}')
    cols[3].metric("平均 PnL", f'{summary["average_pnl"]:,.2f}')
    cols[4].metric("最大回撤", f'{summary["max_drawdown"]:,.2f}')

    if not result.equity_curve.empty:
        st.subheader("权益曲线")
        st.line_chart(result.equity_curve.set_index("exit_time")["cumulative_pnl"])

    st.subheader("交易明细")
    st.dataframe(result.trades, use_container_width=True)

    c1, c2, c3 = st.columns(3)
    with c1:
        st.subheader("按月")
        st.dataframe(result.by_month, use_container_width=True)
    with c2:
        st.subheader("按 Gap 桶")
        st.dataframe(result.by_gap_bucket, use_container_width=True)
    with c3:
        st.subheader("按 VIX1D 桶")
        st.dataframe(result.by_vix_bucket, use_container_width=True)

    if not result.skipped_days.empty:
        st.subheader("跳过日期")
        st.dataframe(result.skipped_days, use_container_width=True)


if __name__ == "__main__":
    main()

