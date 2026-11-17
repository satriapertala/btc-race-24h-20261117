// Rolling-window swing capture, long-only, all-in, on CBBTC/USDC minute bars.
//
// Window N = 240 closes. Signal read on the bar that just closed (fills land at the next open):
//   BUY  when close <= min(last 240 closes) * (1 + 5 bps)   -- price is at the window low
//        AND close >= open of that bar                       -- and the dip bar closed green
//   SELL while holding when any of:
//        close >= max(last 240 closes) * (1 - 5 bps)         -- back at the window high
//        take profit: close >= entry * 1.015
//        stop loss:   close <= entry * 0.992
// Sizing is all-in, capped by caps.max_weight_bps of equity, with MAX_SLIPPAGE_BPS = 100.
// Entry price comes from the fill report (batch.fills), so TP/SL anchor on what was paid.
//
// Arithmetic is BigInt only and every ratio is compared cross-multiplied, so the run is exact
// and deterministic: same bars in, same order log out. No clock, no environment, no randomness.

import { BPS, runBars, type BarsState, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

const WINDOW = 300;
/** Buy tolerance above the window low, and sell tolerance below the window high, in bps. */
const EDGE_TOLERANCE_BPS = 5n;
const TEN_K = 10_000n;
/** Take profit at +1.5%, stop loss at -0.8% from the fill price. */
const TP_MULT = 1015n / 1000n === 1n ? 1015n : 1015n; // close*1000 >= entry*1015  (1.015x)
const SL_MULT = 992n;                                  // close*1000 <= entry*992   (0.992x)
const THOUSAND = 1000n;
const MAX_SLIPPAGE_BPS = 100;

/** Closes of CBBTC seen so far, oldest first; only the last WINDOW are ever read. */
const closes: bigint[] = [];
/** Fill price of the open position, or null when flat. */
let entryPrice: bigint | null = null;

const symbol = (state: BarsState): string => state.hello.symbols[0]!.symbol;

function windowMin(): bigint {
  let m = closes[0]!;
  for (let i = 1; i < closes.length; i++) if (closes[i]! < m) m = closes[i]!;
  return m;
}

function windowMax(): bigint {
  let m = closes[0]!;
  for (let i = 1; i < closes.length; i++) if (closes[i]! > m) m = closes[i]!;
  return m;
}

await runBars({
  onBatch(state, batch): OrderInput[] {
    const sym = symbol(state);

    // Anchor the entry price on the fill the harness just reported (decided last batch, filled
    // at this batch's open). A sell fill clears it.
    for (const f of batch.fills) {
      if (f.symbol !== sym || f.status !== 'filled') continue;
      if (f.side === 'buy') entryPrice = BigInt(f.price);
      else entryPrice = null;
    }

    const bar = state.latest.get(sym);
    if (bar === undefined) return [];
    const open = BigInt(bar.o);
    const close = BigInt(bar.c);
    closes.push(close);
    if (closes.length > WINDOW) closes.shift();

    const held = state.positions.get(sym);
    if (held !== undefined && held.qty > 0n) {
      // ---- holding: look for the exit
      const nearHigh = close * TEN_K >= windowMax() * (TEN_K - EDGE_TOLERANCE_BPS);
      const takeProfit = entryPrice !== null && close * THOUSAND >= entryPrice * TP_MULT;
      const stopLoss = entryPrice !== null && close * THOUSAND <= entryPrice * SL_MULT;
      if (nearHigh || takeProfit || stopLoss) {
        return [{ side: 'sell', symbol: sym, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // ---- flat: look for the entry
    if (state.warmingUp || closes.length < WINDOW) return [];
    const nearLow = close * TEN_K <= windowMin() * (TEN_K + EDGE_TOLERANCE_BPS);
    const turnedUp = close >= open;
    if (!nearLow || !turnedUp) return [];

    // All-in, capped by the weight cap; a buy's notional is the cash it spends, fee inside.
    const byWeight = (BigInt(state.hello.caps.max_weight_bps) * state.equity) / BPS;
    const spend = state.cash < byWeight ? state.cash : byWeight;
    if (spend === 0n || spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: sym, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
