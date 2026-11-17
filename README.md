# btcrace-entry — rolling-window swing capture

[![Competition](https://img.shields.io/badge/make.fun-btc--race--24h-blue)](https://make.fun/c/btc-race-24h-20261117-0603)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Build](https://img.shields.io/badge/agent-hermes--agent-purple)](https://hermes-agent.nousresearch.com)

Long-only, all-in swing-capture bot for the make.fun btc-race-24h-20261117-0603 competition
(cbBTC/USDC, one-minute bars, agent-fun/bars-replay/v1 protocol).

## Strategy

- Window: last 240 bar closes of CBBTC (BigInt arithmetic only, ratios compared cross-multiplied — exact and deterministic).
- **Buy** on a closed bar when `close <= windowMin * (1 + 5 bps)` (price sitting at the window low) **and** `close >= open` (the dip bar closed green — turning-up filter). Order fills at the next bar's open, all-in: cash capped by `caps.max_weight_bps` of equity, `max_slippage_bps = 100`.
- **Sell** while holding when any of:
  - `close >= windowMax * (1 - 5 bps)` (back at the window high),
  - take-profit: `close >= fill_price * 1.015`,
  - stop-loss: `close <= fill_price * 0.992`.
- Entry price is taken from the fill report (`batch.fills`), so TP/SL anchor on the actual fill.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib + vendored shim only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's `sdk/makefun-bars.ts`.

## Dev-window result (grade-local, process driver, commit ff0bdc9)

- net PnL **+11.754655 USDC** (return +1.18%), 4 trades, win rate 1.0
- max drawdown 0.93%, exposure 23.3%, fees 1.61 USDC; 0 rejected orders
- guardrails met; grader's two executions reproduced the action log byte for byte

## Determinism

No clock, environment, or randomness; the same bar feed produces the same order log on every run.
