/**
 * Live broker settlement evidence.
 *
 * After a confirmed live place we freeze the account balance (post-stake).
 * At expiry:
 *   WIN  — balance has increased from that cache AND the expiry candle
 *          closed in the executed direction. Either signal alone is not
 *          enough for a win; together they match a broker payout.
 *   LOSS — expiry candle closed against the executed direction. Stake was
 *          already taken at place, so the cached balance does not move.
 *
 * A later candle must never be used as the option close. A paid-out
 * balance increase vetoes a candle-loss so a broker win cannot be stored
 * as a local loss.
 */

const LIVE_SETTLEMENT_GRACE_MS = 2000;
const LIVE_WIN_BALANCE_WAIT_MS = 15_000;
const PLACE_BALANCE_DEBIT_WINDOW_MS = 5_000;
const EXPIRY_BAR_CLOSE_SLACK_MS = 250;
const EXPIRY_BAR_MAX_OVERSHOOT_MS = 5_000;
const BALANCE_UP_EPS = 0.01;

function candleTimeFieldMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1e12 ? n : n * 1000;
}

function candleOpenTimeMs(closedCandle) {
  if (!closedCandle || typeof closedCandle !== 'object') return null;
  return candleTimeFieldMs(closedCandle.from) ?? candleTimeFieldMs(closedCandle.time);
}

function candleCloseTimeMs(closedCandle) {
  if (!closedCandle || typeof closedCandle !== 'object') return Date.now();
  const to = candleTimeFieldMs(closedCandle.to);
  if (to != null) return to;
  const from = candleTimeFieldMs(closedCandle.from);
  const size = Number(closedCandle.size);
  if (from != null && Number.isFinite(size) && size > 0) {
    const sizeMs = size >= 1e6 ? size : size * 1000;
    return from + sizeMs;
  }
  return candleTimeFieldMs(closedCandle.time) ?? Date.now();
}

function isExpirySettlementBar(openMs, closeMs, expiry) {
  if (![openMs, closeMs, expiry].every((n) => Number.isFinite(n) && n > 0)) return false;
  if (openMs >= expiry) return false;
  const closeDelta = closeMs - expiry;
  if (closeDelta < -EXPIRY_BAR_CLOSE_SLACK_MS) return false;
  if (closeDelta > EXPIRY_BAR_MAX_OVERSHOOT_MS) return false;
  return true;
}

function candleDirectionOutcome(direction, entryPrice, exitPrice) {
  const dir = String(direction || '').toLowerCase();
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
  if (dir === 'call') {
    if (exit > entry) return 'WIN';
    if (exit < entry) return 'LOSS';
    return 'TIE';
  }
  if (dir === 'put') {
    if (exit < entry) return 'WIN';
    if (exit > entry) return 'LOSS';
    return 'TIE';
  }
  return null;
}

function isBalanceIncreased(afterPlace, live, eps = BALANCE_UP_EPS) {
  return Number.isFinite(Number(afterPlace))
    && Number.isFinite(Number(live))
    && Number(live) > Number(afterPlace) + eps;
}

function netProfitFromBalance(trade, live, afterPlace) {
  const delta = Number(live) - Number(afterPlace);
  const stake = Number(trade?.stake) || 0;
  if (!Number.isFinite(delta)) return null;
  // Post-place cache is after the stake debit: payout returns stake + profit.
  if (stake > 0 && delta > stake + BALANCE_UP_EPS) {
    return Number((delta - stake).toFixed(2));
  }
  return Number(delta.toFixed(2));
}

/**
 * Decide a live fallback outcome from the frozen post-place balance and
 * the expiry-bar close. Returns outcome=null when evidence is not ready.
 */
function resolveLiveExpirySettlement(trade, { now = Date.now() } = {}) {
  const exitPrice = Number(trade?.expiryQuote);
  if (!Number.isFinite(exitPrice)) {
    return { outcome: null, reason: 'no-expiry-quote', exitPrice: null };
  }

  const candle = candleDirectionOutcome(trade.direction, trade.entryPrice, exitPrice);
  const afterPlace = Number(trade.balanceAfterPlace);
  const live = Number(trade.balanceAfterSettlement?.amount);
  const stake = Number(trade.stake);
  const expiry = Number(trade.expiryTime) || 0;

  if (now < expiry + LIVE_SETTLEMENT_GRACE_MS) {
    return { outcome: null, reason: 'grace', exitPrice, candle };
  }

  if (!Number.isFinite(afterPlace) || !Number.isFinite(live)
    || Number(trade.balanceAfterSettlement?.capturedAt) < expiry || !(stake > 0)) {
    return { outcome: null, reason: 'awaiting-settlement-balance', exitPrice, candle };
  }
  const delta = Number((live - afterPlace).toFixed(2));
  const eps = BALANCE_UP_EPS;
  if (delta < -eps) return { outcome: null, reason: 'abnormal-negative-balance-change', exitPrice, candle, delta };
  if (delta <= eps) return { outcome: 'LOSS', profit: -stake, reason: 'balance-no-increase', exitPrice, candle, delta };
  if (Math.abs(delta - stake) <= eps) return { outcome: 'TIE', profit: 0, reason: 'balance-stake-returned', exitPrice, candle, delta };
  // Gross return is at most 2x stake (stake returned plus profit capped at stake).
  if (delta > stake + eps && delta <= 2 * stake + eps) {
    return { outcome: 'WIN', profit: Number((delta - stake).toFixed(2)), reason: 'balance-and-candle', exitPrice, candle, delta };
  }
  return { outcome: null, reason: 'abnormal-balance-increase', exitPrice, candle, delta };
}

function applyLiveBalanceSample(trade, amount, { now = Date.now() } = {}) {
  if (!trade || trade.isPaper) return trade;
  const n = Number(amount);
  if (!Number.isFinite(n)) return trade;
  trade.liveBalance = n;
  trade.balanceSnapshots ||= [];
  const snapshot = { amount: n, capturedAt: now, phase: trade.balanceAfterPlace == null ? 'after-place' : (now >= Number(trade.expiryTime) ? 'after-settlement' : 'live') };
  trade.balanceSnapshots.push(snapshot);
  if (trade.balanceSnapshots.length > 20) trade.balanceSnapshots.shift();

  const placedAt = Number(trade.placedAt || trade.entryTime) || 0;
  const inDebitWindow = placedAt > 0 && now - placedAt < PLACE_BALANCE_DEBIT_WINDOW_MS;
  if (trade.balanceAfterPlace == null) {
    trade.balanceAfterPlace = n;
    trade.balanceAfterPlaceSnapshot = snapshot;
    return trade;
  }
  if (now >= Number(trade.expiryTime)) trade.balanceAfterSettlement = snapshot;
  if (trade.balanceAfterPlaceFrozen) return trade;
  // Stake debit often lands a moment after the place reply. Accept one
  // downward correction shortly after place, then freeze the baseline.
  if (inDebitWindow && n < Number(trade.balanceAfterPlace) - 0.005) {
    trade.balanceAfterPlace = n;
    trade.balanceAfterPlaceSnapshot = snapshot;
  }
  if (!inDebitWindow) trade.balanceAfterPlaceFrozen = true;
  return trade;
}

module.exports = {
  LIVE_SETTLEMENT_GRACE_MS,
  LIVE_WIN_BALANCE_WAIT_MS,
  PLACE_BALANCE_DEBIT_WINDOW_MS,
  candleOpenTimeMs,
  candleCloseTimeMs,
  isExpirySettlementBar,
  candleDirectionOutcome,
  isBalanceIncreased,
  netProfitFromBalance,
  resolveLiveExpirySettlement,
  applyLiveBalanceSample,
};
