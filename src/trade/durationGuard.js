/**
 * Duration Guard
 *
 * Root-cause fix for: "a trade executed with 0 duration, the server
 * rejected it, but it was still counted as a trade locally."
 *
 * That happened because the old executeSignal() computed `expired`
 * (an epoch-seconds expiry) from product-specific selectors, and if
 * that value came back 0 / NaN / in the past, nothing stopped the
 * broker call from firing — and nothing stopped recordPlacement()
 * from firing afterwards regardless of whether the broker accepted
 * the order. There was also a silent fallback
 * (`Number.isFinite(expired) ? expired*1000 : Date.now()+timeframe*1000`)
 * that manufactured a fake expiry instead of failing loudly.
 *
 * This module is the single place duration validity is decided. It is
 * a pure function with no I/O, so it's trivial to unit test in isolation
 * and every placer (turbo/blitz/binary/digital) is required to run its
 * computed expiry through it *before* any broker call is made.
 */

// Broker-observed floor. Anything shorter than this is functionally a
// 0-duration trade even if it's technically > 0ms (e.g. 200ms from a
// stale quote or a mis-selected duration table entry).
const DEFAULT_MIN_DURATION_MS = 5000;

class InvalidDurationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'InvalidDurationError';
    this.details = details;
  }
}

/**
 * expiredEpochSeconds: the "expired" field sent to the broker (epoch seconds).
 * Returns ms remaining until that expiry, or NaN if unusable.
 */
function resolveDurationMs(expiredEpochSeconds, now = Date.now()) {
  const n = Number(expiredEpochSeconds);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n * 1000 - now;
}

/**
 * Throws InvalidDurationError unless the expiry is a finite, future
 * timestamp at least minDurationMs away. Never falls back to a
 * fabricated duration — callers must treat a throw here as "do not
 * place this trade", full stop.
 */
function assertValidExpiry(expired, { now = Date.now(), minDurationMs = DEFAULT_MIN_DURATION_MS, label = 'trade' } = {}) {
  const durationMs = resolveDurationMs(expired, now);

  if (!Number.isFinite(durationMs)) {
    throw new InvalidDurationError(
      `${label}: expiry is missing or not a finite positive value (expired=${expired})`,
      { expired, durationMs }
    );
  }
  if (durationMs <= 0) {
    throw new InvalidDurationError(
      `${label}: expiry is in the past or equal to now (durationMs=${durationMs})`,
      { expired, durationMs }
    );
  }
  if (durationMs < minDurationMs) {
    throw new InvalidDurationError(
      `${label}: duration ${durationMs}ms is below the minimum safe duration ${minDurationMs}ms`,
      { expired, durationMs, minDurationMs }
    );
  }
  return durationMs;
}

module.exports = {
  DEFAULT_MIN_DURATION_MS,
  InvalidDurationError,
  resolveDurationMs,
  assertValidExpiry,
};
