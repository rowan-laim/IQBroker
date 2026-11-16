/**
 * executeTrade()
 *
 * The hardened replacement for the placement half of the old
 * TradingEngine.executeSignal(). Every product goes through the same
 * three-stage pipeline, in order, with no shortcuts:
 *
 *   1. placer.prepare(ctx)          — compute the intended expiry (product-specific)
 *   2. durationGuard.assertValidExpiry — hard-fail on 0 / past / sub-minimum duration
 *   3. executionGuard.guardedPlace  — call the broker, classify the result
 *
 * recordPlacement() on the TradeManager is reachable ONLY from a CONFIRMED
 * outcome. A REJECTED or unresolved UNCERTAIN outcome always throws instead
 * — nothing downstream of this function can accidentally treat "the broker
 * said no" or "we don't actually know" as "trade is open".
 */

const { getPlacer } = require('./placement/registry');
const { assertValidExpiry, DEFAULT_MIN_DURATION_MS } = require('./durationGuard');
const { guardedPlace, OUTCOME } = require('./executionGuard');

async function executeTrade(ctx) {
  const {
    product,
    tradeManager,
    minDurationMs = DEFAULT_MIN_DURATION_MS,
    onRecoverUncertain,
    asset,
    direction,
    stake,
    signal,
  } = ctx;

  if (!product) throw new Error('executeTrade: ctx.product is required');
  if (!tradeManager) throw new Error('executeTrade: ctx.tradeManager is required');
  if (!asset || asset.activeId == null) throw new Error('executeTrade: ctx.asset with activeId is required');
  if (String(ctx.account || '').toLowerCase() === 'real' && typeof ctx.beforePlace !== 'function') {
    throw new Error('executeTrade: live orders require a final risk authorization gate');
  }

  const placer = getPlacer(product);
  const prepared = await placer.prepare(ctx);
  const now = Date.now();

  // Hard gate: nothing with a non-positive, NaN, or sub-minimum duration
  // is ever sent to the broker. A 0-duration trade should die here, not
  // after a rejection that then gets counted anyway.
  assertValidExpiry(prepared.expired, { now, minDurationMs, label: product });

  // This synchronous final gate runs after any asynchronous placer setup and
  // immediately before the broker placement call, so account or risk state
  // changes during preparation cannot slip into an order.
  if (typeof ctx.beforePlace === 'function') ctx.beforePlace({ prepared, product });

  const guardResult = await guardedPlace(() => placer.place(ctx, prepared), {
    label: product,
    onUncertain: onRecoverUncertain,
  });

  if (guardResult.outcome === OUTCOME.REJECTED) {
    const err = guardResult.error instanceof Error
      ? guardResult.error
      : new Error(`${product} placement rejected by broker`);
    err.placementOutcome = guardResult;
    throw err;
  }

  if (guardResult.outcome === OUTCOME.UNCERTAIN) {
    // Genuinely unknown whether this filled. Never record it as an open
    // trade here — that is exactly how a rejected/ambiguous placement
    // used to get counted. Caller can poll positions/orders later and
    // resolve it explicitly via TradeManager.findUnconfirmedMatch +
    // recordPlacement({ unconfirmed: true, ... }) if it wants to track
    // the ambiguity instead of dropping it.
    //
    // If onRecoverUncertain was supplied and ran (e.g. TradeReconciler.reconcileWithRetry),
    // it means no matching position/balance event arrived within the wait window —
    // the trade genuinely did not execute server-side, or push events are severely delayed.
    const err = new Error(
      `${product} placement outcome is uncertain — broker acked the request but returned no position id. ` +
      `WebSocket reconciler found no matching position within the recovery window. ` +
      `This is likely a broker-side delay or market closure. No trade has been recorded.`
    );
    err.placementOutcome = guardResult;
    throw err;
  }

  const isDigital = product === 'digital';
  const placeId = guardResult.placeId;
  const record = tradeManager.recordPlacement({
    id: placeId != null ? String(placeId) : undefined,
    orderId: placeId,
    positionId: isDigital ? null : placeId,
    externalId: isDigital ? null : placeId,
    activeId: asset.activeId,
    symbol: asset.symbol,
    product,
    direction,
    stake,
    entryPrice: ctx.entryPrice,
    entryTime: now,
    expiryTime: prepared.expired * 1000,
    payoutPercent: asset.payoutPercent || 80,
    levelType: signal?.strategy || 'narrative_strategy',
    confidence: signal?.confidence || 0.8,
    signalType: signal?.strategy || null,
    signalId: signal?.id || signal?.signalId || null,
    patternId: signal?.patternId || signal?.strategy || null,
    patternVariantId: signal?.patternVariantId || signal?.metadata?.patternVariantId || null,
    variant: signal?.metadata?.variant || null,
    snapshotId: signal?.snapshotId || signal?.candidateId || null,
    account: ctx.account,
    stakeTier: ctx.stakeTier,
    balanceBefore: ctx.balanceBefore,
    expirationSize: prepared.expirationSize ?? null,
    instrumentId: guardResult.res?._digitalStrike || null,
    unconfirmed: false,
    recovered: guardResult.recovered === true,
    rawPlaceReply: guardResult.res,
  });

  return { record, res: guardResult.res, prepared, outcome: guardResult.outcome };
}

module.exports = { executeTrade };
