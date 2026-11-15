/** Timing rules for the option products. All timestamps are Unix seconds. */

function assertDuration(durationSeconds) {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`durationSeconds must be a positive integer, got ${durationSeconds}`);
  }
}

/**
 * Binary durations start at the *next* duration boundary. This intentionally
 * adds a full selected duration after rounding up: a 5-minute choice at
 * 10:04 settles at 10:10, not 10:05.
 */
function binaryExpiryForDuration(durationSeconds, nowSec = Math.floor(Date.now() / 1000)) {
  assertDuration(durationSeconds);
  return Math.ceil(nowSec / durationSeconds) * durationSeconds + durationSeconds;
}

/**
 * Blitz duration is counted from order acceptance; it is not aligned to a
 * candle grid and never receives binary's extra window.
 */
function blitzExpiryForDuration(durationSeconds, nowSec = Math.floor(Date.now() / 1000)) {
  assertDuration(durationSeconds);
  return nowSec + durationSeconds;
}

/**
 * Pick a Blitz expiration_size for a signal.
 *
 * Blitz itself is free-running (`now + N`) — it does NOT need turbo-style
 * grid alignment. The *desired* duration is still the same timeframe the
 * other products target (e.g. 60s / 300s from the signal). When the server
 * advertises a discrete list, prefer an exact match, otherwise the closest
 * advertised size so the order still lands on a legal window.
 */
function advertisedBlitzDurations(availableDurations) {
  return [...new Set((availableDurations || []).map(Number))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function closestBlitzDuration(available, desiredSeconds) {
  if (!available.length) return desiredSeconds;
  if (available.includes(desiredSeconds)) return desiredSeconds;
  return available.reduce((best, value) => {
    const dNew = Math.abs(value - desiredSeconds);
    const dBest = Math.abs(best - desiredSeconds);
    if (dNew < dBest) return value;
    if (dNew === dBest) return value < best ? value : best;
    return best;
  });
}

function selectBlitzDuration(availableDurations, desiredSeconds) {
  assertDuration(desiredSeconds);
  return closestBlitzDuration(advertisedBlitzDurations(availableDurations), desiredSeconds);
}

/**
 * Plans a Blitz order that lands on the next candle close. Blitz itself
 * expires N seconds after acceptance, so the order may need to wait before
 * opening. It never substitutes a full timeframe as the duration.
 *
 * When no advertised size fits under the remaining window, the planner
 * no longer refuses — it picks the closest advertised duration and enters
 * immediately (exact: false). Pass `{ strict: true }` to keep the old throw.
 */
function planBlitzCandleClose(
  availableDurations,
  timeframeSeconds,
  nowSec = Math.floor(Date.now() / 1000),
  entryLeadSeconds = 1,
  { strict = false } = {}
) {
  assertDuration(timeframeSeconds);
  if (!Number.isInteger(entryLeadSeconds) || entryLeadSeconds < 0) {
    throw new Error(`entryLeadSeconds must be a non-negative integer, got ${entryLeadSeconds}`);
  }
  const closeAt = (Math.floor(nowSec / timeframeSeconds) + 1) * timeframeSeconds;
  const remaining = closeAt - nowSec;
  const available = advertisedBlitzDurations(availableDurations);
  const fitting = available.filter((value) => value + entryLeadSeconds <= remaining);
  const duration = fitting.length
    ? fitting[fitting.length - 1]
    : closestBlitzDuration(available, Math.max(1, remaining - entryLeadSeconds));
  if (!duration) {
    throw new Error(`No advertised Blitz duration can reach the next ${timeframeSeconds}s candle close`);
  }
  if (!fitting.length && strict) {
    throw new Error(`No advertised Blitz duration can reach the next ${timeframeSeconds}s candle close`);
  }
  const exact = fitting.length > 0;
  const executeAt = exact ? closeAt - duration - entryLeadSeconds : nowSec;
  return {
    closeAt,
    duration,
    entryLeadSeconds,
    executeAt,
    waitSeconds: Math.max(0, executeAt - nowSec),
    exact,
  };
}

/**
 * Immediate-only version of the candle-close plan.
 *
 * Prefers an advertised duration that expires at the next chart boundary.
 * If that exact remaining window is not advertised, picks the closest
 * advertised size and still enters now (exact: false) instead of refusing.
 * Pass `{ strict: true }` to keep the old throw.
 */
function planImmediateBlitzCandleClose(
  availableDurations,
  timeframeSeconds,
  nowSec = Math.floor(Date.now() / 1000),
  entryLeadSeconds = 1,
  { strict = false } = {}
) {
  assertDuration(timeframeSeconds);
  if (!Number.isInteger(entryLeadSeconds) || entryLeadSeconds < 0) {
    throw new Error(`entryLeadSeconds must be a non-negative integer, got ${entryLeadSeconds}`);
  }
  const closeAt = (Math.floor(nowSec / timeframeSeconds) + 1) * timeframeSeconds;
  const remaining = closeAt - nowSec - entryLeadSeconds;
  const available = advertisedBlitzDurations(availableDurations);
  if (available.includes(remaining)) {
    return { closeAt, duration: remaining, entryLeadSeconds, executeAt: nowSec, waitSeconds: 0, exact: true };
  }
  if (strict) {
    throw new Error(
      `Cannot enter immediately and close at ${closeAt}: need ${remaining}s, ` +
      `but available Blitz durations are ${availableDurations.join(', ')}`
    );
  }
  if (!available.length) {
    throw new Error('No advertised Blitz durations');
  }
  const duration = closestBlitzDuration(available, Math.max(1, remaining));
  return { closeAt, duration, entryLeadSeconds, executeAt: nowSec, waitSeconds: 0, exact: false };
}

/**
 * Digital contracts are 1m / 5m / 15m. The wire `period` is seconds
 * (60 / 300 / 900). Callers sometimes pass minutes (1 / 5 / 15) — treat
 * those as minutes, never as 1-second / 5-second durations.
 */
const DIGITAL_MINUTE_PERIODS = new Set([1, 5, 15]);
const DIGITAL_ENTRY_SLACK_SEC = 20;
const DIGITAL_MIN_REMAINING_SEC = 15;

function digitalPeriodSeconds(duration) {
  const i = Math.round(Number(duration));
  if (!Number.isInteger(i) || i <= 0) {
    throw new Error(`digital duration must be a positive integer (1m/5m/15m or 60s/300s/900s), got ${duration}`);
  }
  if (DIGITAL_MINUTE_PERIODS.has(i)) return i * 60;
  return i;
}

function instrumentPeriodSeconds(period) {
  const i = Math.round(Number(period));
  if (!Number.isInteger(i) || i <= 0) return NaN;
  if (DIGITAL_MINUTE_PERIODS.has(i)) return i * 60;
  return i;
}

function digitalMinRemainingSec(periodSec, minRemainingSec = null) {
  if (minRemainingSec != null) return minRemainingSec;
  return Math.max(DIGITAL_MIN_REMAINING_SEC, Math.min(DIGITAL_ENTRY_SLACK_SEC, periodSec - 10));
}

/**
 * Next period-aligned expiry that still has a full 1m/5m/15m window.
 * A 5m request at 10:04:59 must land on 10:10, not the 1s-left 10:05 slot.
 */
function digitalTargetExpiry(duration, nowSec = Math.floor(Date.now() / 1000), slackSec = DIGITAL_ENTRY_SLACK_SEC) {
  const periodSec = digitalPeriodSeconds(duration);
  let close = nextCandleCloseAt(periodSec, nowSec);
  if (close - nowSec < periodSec - slackSec) close += periodSec;
  return close;
}

function digitalInstrumentStillValid(instrument, timeframeSeconds, nowMs = Date.now()) {
  if (!instrument) return false;
  const periodSec = instrumentPeriodSeconds(instrument.period) || digitalPeriodSeconds(timeframeSeconds);
  const remainMs = Number(instrument.expiration) * 1000 - nowMs;
  return Number.isFinite(remainMs) && remainMs >= digitalMinRemainingSec(periodSec) * 1000;
}

/**
 * Digital expiry is server-authoritative: match the 1m/5m/15m period, then
 * the soonest instrument that still has a full contract window left.
 */
function selectDigitalInstrument(instruments, durationSeconds, nowSec = Math.floor(Date.now() / 1000), targetExpirySec = null, minRemainingSec = null) {
  const periodSec = digitalPeriodSeconds(durationSeconds);
  const minRemain = digitalMinRemainingSec(periodSec, minRemainingSec);
  const target = targetExpirySec != null ? Number(targetExpirySec) : null;
  const candidates = (instruments || [])
    .filter((item) => {
      if (instrumentPeriodSeconds(item?.period) !== periodSec) return false;
      const exp = Number(item?.expiration);
      if (!Number.isFinite(exp)) return false;
      if (exp <= nowSec + minRemain) return false;
      if (Number.isFinite(target) && Math.abs(exp - target) > 5 && exp < target) return false;
      return true;
    })
    .sort((a, b) => Number(a.expiration) - Number(b.expiration));
  return candidates[0] || null;
}

/**
 * Digital place-digital-option wants a strike *symbol* (instrument_id), not the
 * parent instrument index row. Capture + live UI always trade ATM spot (SPT):
 *   call -> ...T#MCSPT
 *   put  -> ...T#MPSPT
 *
 * `instrument.data[]` from get-instruments / instrument-generated carries both.
 * Only SPT is eligible here; choosing another strike would silently change
 * the contract requested by the strategy.
 *
 * @param {object} instrument - one row from getDigitalInstruments().instruments
 * @param {'call'|'put'} direction
 * @returns {{ symbol:string, strike:string, direction:string}|null}
 */
function selectDigitalStrike(instrument, direction) {
  if (!instrument || (direction !== 'call' && direction !== 'put')) return null;
  const rows = Array.isArray(instrument.data) ? instrument.data : [];
  const spt = rows.find(
    (row) =>
      row &&
      String(row.strike).toUpperCase() === 'SPT' &&
      String(row.direction).toLowerCase() === direction &&
      row.symbol
  );
  if (spt) return { symbol: spt.symbol, strike: 'SPT', direction };
  // Price-feed shape: prices[].{call|put}.symbol (no data[] on the instrument).
  const fromPrice = instrument.prices?.find?.((p) => String(p.strike).toUpperCase() === 'SPT')
    || instrument.prices?.[0];
  const side = fromPrice?.[direction];
  if (String(fromPrice?.strike).toUpperCase() === 'SPT' && side?.symbol) {
    return { symbol: side.symbol, strike: 'SPT', direction };
  }
  return null;
}

/**
 * Walk the server's live turbo expiry grid. Returns null fields when the
 * init payload is unusable — callers still throw in that case.
 *
 * IQ Option Turbo options roll dynamically with current time (nowSec), offering
 * expiration boundaries (typically every 60s) into the future. Using a static
 * start_time from socket connection can cause expiries to be in the past or
 * miss the candle-close boundary, causing trades to snap to premature expirations.
 */
function turboGridExpiries(activeInit, nowSec = Math.floor(Date.now() / 1000)) {
  const option = activeInit?.option;
  const gridSeconds = Number(option?.exp_time || option?.expiration_times?.[0]);
  const start = Number(option?.start_time);
  const rawCount = Number(option?.count);
  const deadtime = Number(activeInit?.deadtime || 0);
  if (!Number.isInteger(gridSeconds) || gridSeconds <= 0) {
    return null;
  }

  const count = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : 5;
  const phase = Number.isInteger(start) ? ((start % gridSeconds) + gridSeconds) % gridSeconds : 0;

  // Calculate the live grid boundary on or before nowSec matching phase alignment
  let base = Math.floor(nowSec / gridSeconds) * gridSeconds + phase;
  if (base < nowSec) base += gridSeconds;

  // Generate rolling grid slots (at least count + 5, minimum 10)
  // to cover full candle-close boundaries (e.g. 5-minute candles).
  const numSlots = Math.max(count, 5) + 5;
  const expiries = [];
  for (let i = 0; i < numSlots; i++) {
    expiries.push(base + i * gridSeconds);
  }
  return { expiries, deadtime, gridSeconds, start, count };
}

function nearestLiveTurboExpiry(expiries, desired, minExpiry) {
  const live = expiries.filter((e) => e > minExpiry);
  if (!live.length) return null;
  return live.reduce((best, e) =>
    Math.abs(e - desired) < Math.abs(best - desired) ? e : best
  );
}

/**
 * Selects a turbo close time from the server's current expiry grid.
 * Unlike binary, this never adds an extra duration. Prefers the next
 * candle-close (or an explicit targetExpiry) when that slot is live;
 * otherwise snaps to the nearest still-open grid expiry instead of
 * refusing the order.
 */
function selectTurboExpiry(activeInit, timeframeSeconds, nowSec = Math.floor(Date.now() / 1000), targetExpiry) {
  assertDuration(timeframeSeconds);
  const grid = turboGridExpiries(activeInit, nowSec);
  if (!grid) throw new Error('Turbo initialization data does not contain a usable expiry grid');
  const { expiries, deadtime } = grid;
  const minExpiry = nowSec + deadtime;

  let desired;
  if (targetExpiry == null) {
    desired = nextCandleCloseAt(timeframeSeconds, nowSec);
    while (desired <= minExpiry) desired += timeframeSeconds;
  } else {
    desired = Number(targetExpiry);
    if (!Number.isInteger(desired)) throw new Error(`targetExpiry must be a Unix-second integer, got ${targetExpiry}`);
  }

  if (expiries.includes(desired) && desired > minExpiry) return desired;

  const snapped = nearestLiveTurboExpiry(expiries, desired, minExpiry);
  if (snapped == null) {
    throw new Error(`Turbo expiry grid has no live slot after ${minExpiry}s (deadtime ${deadtime}s)`);
  }
  return snapped;
}

/**
 * Next candle-close boundary on the wall-clock grid.
 * Example: 5m candles close at :00, :05, :10, ... never mid-bar.
 */
function nextCandleCloseAt(timeframeSeconds, nowSec = Math.floor(Date.now() / 1000)) {
  assertDuration(timeframeSeconds);
  if (!Number.isFinite(nowSec)) throw new Error(`nowSec must be a finite number, got ${nowSec}`);
  return (Math.floor(nowSec / timeframeSeconds) + 1) * timeframeSeconds;
}

/**
 * Milliseconds until the next candle close, for scheduling heartbeats that
 * fire only when a bar actually finishes (10:00, 10:05, …).
 */
function msUntilNextCandleClose(timeframeSeconds, nowMs = Date.now(), graceMs = 0) {
  assertDuration(timeframeSeconds);
  if (!Number.isFinite(nowMs)) throw new Error(`nowMs must be a finite number, got ${nowMs}`);
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error(`graceMs must be >= 0, got ${graceMs}`);
  const closeAtMs = nextCandleCloseAt(timeframeSeconds, Math.floor(nowMs / 1000)) * 1000 + graceMs;
  return Math.max(0, closeAtMs - nowMs);
}

/**
 * Direction of a finished candle from open → close.
 * green = up, red = down, flat = unchanged.
 */
function candleMove(candle) {
  if (!candle) return null;
  const open = Number(candle.open);
  const close = Number(candle.close);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
  const change = close - open;
  const direction = change > 0 ? 'green' : change < 0 ? 'red' : 'flat';
  return {
    open,
    close,
    change,
    direction,
    from: candle.from != null ? Number(candle.from) : null,
    to: candle.to != null ? Number(candle.to) : null,
    id: candle.id,
  };
}

module.exports = {
  binaryExpiryForDuration,
  planBlitzCandleClose,
  planImmediateBlitzCandleClose,
  blitzExpiryForDuration,
  selectBlitzDuration,
  digitalPeriodSeconds,
  instrumentPeriodSeconds,
  digitalMinRemainingSec,
  digitalTargetExpiry,
  digitalInstrumentStillValid,
  selectDigitalInstrument,
  selectDigitalStrike,
  selectTurboExpiry,
  nextCandleCloseAt,
  msUntilNextCandleClose,
  candleMove,
};
