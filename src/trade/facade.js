const { DEFAULT_MIN_DURATION_MS, InvalidDurationError, resolveDurationMs, assertValidExpiry } = require('./durationGuard');
const { OUTCOME, isExplicitRejection, guardedPlace } = require('./executionGuard');
const { registerPlacer, getPlacer, listProducts } = require('./placement/registry');
const turboPlacer = require('./placement/turboPlacer');
const blitzPlacer = require('./placement/blitzPlacer');
const binaryPlacer = require('./placement/binaryPlacer');
const digitalPlacer = require('./placement/digitalPlacer');
const { resolveStakeFromBalance, DEFAULT_STAKE_TIERS } = require('./stakeSizing');
const TradeManager = require('./tradeManager');
const { summarizeTradeList } = require('./metrics');
const { collectPositionIds, outcomeFromPosition, profitFromPosition, isClosedPosition } = require('./settlement');
const liveSettlement = require('./liveSettlement');
const DeferredExecutor = require('./deferredExecutor');
const tradeRecovery = require('./tradeRecovery');
const { TradeReconciler } = require('./tradeReconciler');
const { executeTrade } = require('./tradeEngine');

// Built-in placers are registered by default but remain fully pluggable —
// a caller can registerPlacer('turbo', myOwnPlacer) to override one, or
// registerPlacer('opt', newPlacer) to add a product this module never
// heard of, without editing anything else in this layer.
registerPlacer('turbo', turboPlacer);
registerPlacer('blitz', blitzPlacer);
registerPlacer('binary', binaryPlacer);
registerPlacer('digital', digitalPlacer);

module.exports = {
  // Duration safety — this is where the 0-duration-trade fix lives.
  DEFAULT_MIN_DURATION_MS,
  InvalidDurationError,
  resolveDurationMs,
  assertValidExpiry,

  // Broker response classification (CONFIRMED / REJECTED / UNCERTAIN)
  OUTCOME,
  isExplicitRejection,
  guardedPlace,

  // Pluggable per-product placement
  registerPlacer,
  getPlacer,
  listProducts,

  // Stake sizing
  resolveStakeFromBalance,
  DEFAULT_STAKE_TIERS,

  // Trade lifecycle ledger
  TradeManager,

  // Stats / performance summary
  summarizeTradeList,

  // Server push -> outcome/profit mapping
  collectPositionIds,
  outcomeFromPosition,
  profitFromPosition,
  isClosedPosition,
  ...liveSettlement,

  // Delayed-entry (reversion/fade/rejection) execution
  DeferredExecutor,

  // Server-fill recovery for timed-out/ambiguous placements
  ...tradeRecovery,
  TradeReconciler,

  // High-level orchestrator: prepare -> validate duration -> place -> record
  executeTrade,
};
