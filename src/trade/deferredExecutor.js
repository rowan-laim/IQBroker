/**
 * Deferred Execution Engine
 *
 * Implements delayed entry rules for reversal, fade, and rejection signals:
 * 1. Reversion (Mid-Band Reversion):
 *    - Huge-inside: wait for Candle 2 to touch the facing outer BB.
 *      Direction is locked to the original signal (never flipped).
 *    - Two-candle / other: wait for a retest of the signal-direction wick.
 *    - Outright clean reversal (Layer 2 Mode B) executes immediately.
 * 2. Fade (Marubozu / Exhaustion Climax Reversals):
 *    - Uses body range (|close - open|).
 *    - Requires price to push 10% further in direction of huge candle body.
 * 3. Rejection (Outer Band Rejection):
 *    - Uses rejection wick range (close to rejection wick extreme).
 *    - Requires price to revisit 10% into the rejected region.
 * 4. Continuations (Band Breakout, Continuation Breakout):
 *    - Immediate execution (no deferral).
 */

const { routeExecutionCategory } = require('./categoryRouter');

class DeferredExecutor {
  constructor(options = {}) {
    this.maxDeferMs = options.maxDeferMs ?? 180000; // 3m window to hit target price
    this.pendingSignals = new Map(); // activeId -> pendingDeferredSignal
    this.options = options;
  }

  _attachRouting(result, { asset, signal, candle, setupKey }) {
    const waitOffset = signal.waitOffset
      || signal.timingOffset
      || (result.deferred ? 'WAIT_1' : 'WAIT_0');
    const structuralDefer = result.deferred
      || signal.executionMode === 'DEFERRED'
      || waitOffset === 'WAIT_FOR_CONFIRMATION'
      || waitOffset === 'WAIT_FOR_RETRACEMENT'
      || waitOffset === 'WAIT_FOR_WICK'
      || waitOffset === 'WAIT_FOR_BREAK';
    result.categoryRouting = routeExecutionCategory({
      emittedCategory: signal.category
        || signal.emittedCategory
        || (asset && asset.product)
        || 'TURBO',
      executionMode: structuralDefer ? 'DEFERRED' : 'IMMEDIATE',
      waitOffset: structuralDefer ? waitOffset : 'WAIT_0',
      structure: setupKey,
      session: candle?.session || signal.session,
      availableCategories: signal.availableCategories,
      fallbackPolicy: signal.categoryFallbackPolicy,
    });
    return result;
  }

  /**
   * Evaluates whether a signal requires deferred execution or immediate execution.
   * Calculates the exact targetPrice trigger.
   */
  prepare(asset, signal, candle) {
    const setupKey = signal.setupKey || signal.setup;
    const direction = signal.direction; // 'call' | 'put'
    const open = candle.open;
    const high = candle.high;
    const low = candle.low;
    const close = candle.close;
    const ctx = { asset, signal, candle, setupKey };

    // Staircase confirmation already closed — execute now, but route as DEFERRED
    // so BLITZ is remapped to TURBO/DIGITAL (pattern-staircase.md section 8).
    if (setupKey === 'staircase' || signal.timingOffset === 'WAIT_FOR_CONFIRMATION') {
      return this._attachRouting({
        deferred: false,
        mode: 'wait_for_confirmation',
        targetPrice: close,
        createdAt: Date.now(),
        asset,
        signal,
        candle,
      }, ctx);
    }

    // Continuations execute immediately
    if (setupKey === 'band_break' || setupKey === 'expansion_continuation') {
      return this._attachRouting({ deferred: false, targetPrice: close, mode: 'immediate' }, ctx);
    }

    let targetPrice = close;
    let mode = 'immediate';

    if (setupKey === 'band_reversion') {
      // Layer 2 Mode B: candle already reversed cleanly — take it now.
      if (signal.reason === 'outright_clean_reversal_fresh') {
        return this._attachRouting({ deferred: false, targetPrice: close, mode: 'immediate' }, ctx);
      }

      mode = 'reversion';

      // Huge-inside: wait for Candle 2 to touch the facing outer band.
      // PUT faces upper BB; CALL faces lower BB. Never arm the opposite side.
      if (signal.reason === 'flat_band_huge_inside_reversion' || signal.hugeInside) {
        const bb = candle.bb || {};
        const bandTarget = direction === 'put' ? bb.upper : bb.lower;
        if (typeof bandTarget === 'number') {
          return this._attachRouting({
            deferred: true,
            mode: 'reversion',
            targetPrice: bandTarget,
            createdAt: Date.now(),
            asset,
            signal,
            candle,
          }, ctx);
        }
      }

      // Two-candle (and fallback) reversion: retest the wick in the
      // already-decided signal direction only.
      const bodyTop = Math.max(open, close);
      const bodyBot = Math.min(open, close);
      const upperWickRange = Math.max(0, high - bodyTop);
      const lowerWickRange = Math.max(0, bodyBot - low);
      const upperTargetPrice = high - 0.20 * upperWickRange;
      const lowerTargetPrice = low + 0.20 * lowerWickRange;

      return this._attachRouting({
        deferred: true,
        mode: 'reversion',
        targetPrice: direction === 'call' ? lowerTargetPrice : upperTargetPrice,
        createdAt: Date.now(),
        asset,
        signal,
        candle,
      }, ctx);
    } else if (setupKey === 'band_rejection') {
      mode = 'rejection';
      // Outer Band Rejection: price in Candle 2 must cover 70% of the rejection candle high/low range before triggering.
      // Upper BB Rejection (PUT): Target price is high - 0.30 * range (retesting top 30% of range / near high).
      // Lower BB Rejection (CALL): Target price is low + 0.30 * range (retesting bottom 30% of range / near low).
      const range = Math.max(0, high - low);
      if (direction === 'put') {
        targetPrice = high - 0.30 * range;
        if (candle.bb && typeof candle.bb.upper === 'number' && targetPrice > candle.bb.upper) {
          targetPrice = candle.bb.upper;
        }
        if (targetPrice <= close && range > 0) {
          targetPrice = Math.max(high, close + 0.05 * range);
        }
      } else {
        targetPrice = low + 0.30 * range;
        if (candle.bb && typeof candle.bb.lower === 'number' && targetPrice < candle.bb.lower) {
          targetPrice = candle.bb.lower;
        }
        if (targetPrice >= close && range > 0) {
          targetPrice = Math.min(low, close - 0.05 * range);
        }
      }

      // Retest distance guard: distance to trigger must be at least 1% of candle range
      const retestDistance = Math.abs(targetPrice - close);
      if (range > 0 && retestDistance < 0.01 * range) {
        mode = 'immediate';
      }
    } else {
      // Immediate execution for all other setups (continuations, expansion rides, marubozu reversals, etc.)
      mode = 'immediate';
    }

    return this._attachRouting({
      deferred: mode !== 'immediate',
      mode,
      targetPrice,
      createdAt: Date.now(),
      asset,
      signal,
      candle,
    }, ctx);
  }

  registerPending(asset, signal, candle, targetInfo) {
    const item = {
      activeId: asset.activeId,
      asset,
      signal: { ...signal },
      candle,
      mode: targetInfo.mode,
      targetPrice: targetInfo.targetPrice,
      upperTargetPrice: targetInfo.upperTargetPrice,
      lowerTargetPrice: targetInfo.lowerTargetPrice,
      createdAt: Date.now(),
      direction: signal.direction,
    };
    this.pendingSignals.set(asset.activeId, item);
    return item;
  }

  /**
   * Evaluates live tick against pending deferred signals.
   * Returns triggered signal item or null.
   */
  evaluateTick(activeId, tick) {
    const pending = this.pendingSignals.get(activeId);
    if (!pending) return null;

    const now = tick.time || Date.now();
    if (now - pending.createdAt > this.maxDeferMs) {
      // Deferral window expired without price touch
      this.pendingSignals.delete(activeId);
      return { status: 'expired', pending };
    }

    const price = tick.price;
    let triggered = false;

    if (pending.mode === 'reversion') {
      // Direction is locked at signal time. A dip after a PUT (or a push
      // after a CALL) must not flip the trade to the opposite side.
      if (pending.direction === 'call' && price <= pending.targetPrice) {
        triggered = true;
      } else if (pending.direction === 'put' && price >= pending.targetPrice) {
        triggered = true;
      }
    } else if (pending.mode === 'fade' || pending.mode === 'rejection') {
      if (pending.direction === 'put' && price >= pending.targetPrice) {
        triggered = true;
      } else if (pending.direction === 'call' && price <= pending.targetPrice) {
        triggered = true;
      }
    } else if (pending.mode === 'fade') {
      const breakDir = pending.signal.breakDirection || (pending.candle.close >= pending.candle.open ? 'call' : 'put');
      if (breakDir === 'call' && price >= pending.targetPrice) { // signal direction is put
        triggered = true;
      } else if (breakDir === 'put' && price <= pending.targetPrice) { // signal direction is call
        triggered = true;
      }
    }

    if (triggered) {
      this.pendingSignals.delete(activeId);
      return { status: 'triggered', pending, fillPrice: price };
    }

    return null;
  }

  clear(activeId) {
    if (activeId) {
      this.pendingSignals.delete(activeId);
    } else {
      this.pendingSignals.clear();
    }
  }
}

module.exports = DeferredExecutor;
