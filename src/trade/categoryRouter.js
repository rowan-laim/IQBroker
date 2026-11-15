/**
 * categoryRouter.js
 * --------------------------------------------------------------------------
 * Deferred Execution Asset-Category Router (BLITZ / TURBO / DIGITAL).
 *
 * Implements Section 29 of `refine.md` and Section 8 of `pattern-staircase.md`:
 *
 * 1. Maintain Two Independent Category Fields:
 *    - EMITTED_CATEGORY: Assigned at signal-generation time (e.g. BLITZ, TURBO, DIGITAL)
 *    - EXECUTION_CATEGORY: Category actually used at the moment of execution
 *
 * 2. Routing Rules:
 *    - if execution_mode === 'IMMEDIATE':
 *        EXECUTION_CATEGORY = EMITTED_CATEGORY
 *    - if execution_mode === 'DEFERRED':
 *        if EMITTED_CATEGORY === 'BLITZ':
 *            // Remap is mandatory! BLITZ + deferred is structurally incompatible
 *            EXECUTION_CATEGORY = select_category({TURBO, DIGITAL})
 *        else:
 *            EXECUTION_CATEGORY = EMITTED_CATEGORY
 *
 * 3. Learned Category Selection:
 *    - Candidate bias (hypotheses tested against empirical data):
 *        TURBO: Favored for short wait offsets (WAIT_0, WAIT_1)
 *        DIGITAL: Favored for longer wait offsets or confirmation waits (WAIT_FOR_CONFIRMATION, WAIT_FOR_RETRACEMENT)
 *
 * 4. Fallback Handling:
 *    - If neither TURBO nor DIGITAL is available:
 *        degrade to IMMEDIATE execution with EXECUTION_CATEGORY = EMITTED_CATEGORY (BLITZ)
 *        OR abstain, logging CATEGORY_FALLBACK. Never silently execute deferred BLITZ.
 * --------------------------------------------------------------------------
 */

'use strict';

const ASSET_CATEGORIES = Object.freeze({
  BLITZ: 'BLITZ',
  TURBO: 'TURBO',
  DIGITAL: 'DIGITAL',
  BINARY: 'BINARY',
});

const ROUTING_REASONS = Object.freeze({
  IMMEDIATE_AS_EMITTED: 'IMMEDIATE_AS_EMITTED',
  BLITZ_DEFERRED_REMAPPED_TURBO: 'BLITZ_DEFERRED_REMAPPED_TURBO',
  BLITZ_DEFERRED_REMAPPED_DIGITAL: 'BLITZ_DEFERRED_REMAPPED_DIGITAL',
  TURBO_OR_DIGITAL_PRESERVED: 'TURBO_OR_DIGITAL_PRESERVED',
  CATEGORY_FALLBACK: 'CATEGORY_FALLBACK',
});

/**
 * Evaluates the required execution category for a signal and timing plan.
 *
 * @param {Object} params
 * @param {string} params.emittedCategory - Original category (BLITZ | TURBO | DIGITAL)
 * @param {string} params.executionMode - 'IMMEDIATE' | 'DEFERRED'
 * @param {string} [params.waitOffset] - 'WAIT_0' | 'WAIT_1' | 'WAIT_2' | 'WAIT_FOR_CONFIRMATION' | 'WAIT_FOR_RETRACEMENT'
 * @param {string} [params.structure] - Setup structure (e.g. 'STAIRCASE', 'POST_IMPULSE_ALTERNATION')
 * @param {string} [params.session] - Market session
 * @param {Array<string>} [params.availableCategories] - Broker categories currently open/tradable for this asset
 * @param {string} [params.fallbackPolicy] - 'DEGRADE_TO_IMMEDIATE' | 'ABSTAIN' (default: 'DEGRADE_TO_IMMEDIATE')
 * @returns {Object} Complete category routing decision
 */
function routeExecutionCategory({
  emittedCategory = ASSET_CATEGORIES.TURBO,
  executionMode = 'IMMEDIATE',
  waitOffset = 'WAIT_0',
  structure = 'UNKNOWN',
  session = 'UNKNOWN',
  availableCategories = [ASSET_CATEGORIES.BLITZ, ASSET_CATEGORIES.TURBO, ASSET_CATEGORIES.DIGITAL],
  fallbackPolicy = 'DEGRADE_TO_IMMEDIATE',
}) {
  const normEmitted = String(emittedCategory || ASSET_CATEGORIES.TURBO).toUpperCase();
  const normMode = String(executionMode || 'IMMEDIATE').toUpperCase();
  const availableSet = new Set((availableCategories || []).map((c) => String(c).toUpperCase()));

  // 1. Immediate execution honors original emitted category
  if (normMode === 'IMMEDIATE') {
    return {
      emittedCategory: normEmitted,
      executionCategory: normEmitted,
      executionMode: 'IMMEDIATE',
      waitOffset: 'WAIT_0',
      remapReason: ROUTING_REASONS.IMMEDIATE_AS_EMITTED,
      categoryFallbackUsed: false,
      allowedToExecute: availableSet.has(normEmitted),
    };
  }

  // 2. Deferred execution with non-BLITZ category
  if (normEmitted !== ASSET_CATEGORIES.BLITZ) {
    const isAvailable = availableSet.has(normEmitted);
    return {
      emittedCategory: normEmitted,
      executionCategory: normEmitted,
      executionMode: 'DEFERRED',
      waitOffset,
      remapReason: ROUTING_REASONS.TURBO_OR_DIGITAL_PRESERVED,
      categoryFallbackUsed: false,
      allowedToExecute: isAvailable,
    };
  }

  // 3. Deferred execution with BLITZ category -> Remap is mandatory!
  // Determine candidate selection preference
  // Short wait (WAIT_0, WAIT_1) -> preference TURBO
  // Longer wait (WAIT_2, WAIT_3, WAIT_FOR_CONFIRMATION, WAIT_FOR_RETRACEMENT) -> preference DIGITAL
  const isShortWait = waitOffset === 'WAIT_0' || waitOffset === 'WAIT_1';
  let primaryCandidate = isShortWait ? ASSET_CATEGORIES.TURBO : ASSET_CATEGORIES.DIGITAL;
  let secondaryCandidate = isShortWait ? ASSET_CATEGORIES.DIGITAL : ASSET_CATEGORIES.TURBO;

  let selectedCategory = null;
  if (availableSet.has(primaryCandidate)) {
    selectedCategory = primaryCandidate;
  } else if (availableSet.has(secondaryCandidate)) {
    selectedCategory = secondaryCandidate;
  }

  if (selectedCategory) {
    const remapReason = selectedCategory === ASSET_CATEGORIES.TURBO
      ? ROUTING_REASONS.BLITZ_DEFERRED_REMAPPED_TURBO
      : ROUTING_REASONS.BLITZ_DEFERRED_REMAPPED_DIGITAL;

    return {
      emittedCategory: normEmitted,
      executionCategory: selectedCategory,
      executionMode: 'DEFERRED',
      waitOffset,
      structure,
      session,
      remapReason,
      categoryFallbackUsed: false,
      allowedToExecute: true,
    };
  }

  // 4. Fallback when neither TURBO nor DIGITAL is tradable (Section 29)
  // Must NOT force deferred BLITZ. Either degrade to IMMEDIATE or abstain.
  if (fallbackPolicy === 'DEGRADE_TO_IMMEDIATE' && availableSet.has(ASSET_CATEGORIES.BLITZ)) {
    return {
      emittedCategory: normEmitted,
      executionCategory: ASSET_CATEGORIES.BLITZ,
      executionMode: 'IMMEDIATE', // Degraded to immediate
      waitOffset: 'WAIT_0',
      structure,
      session,
      remapReason: ROUTING_REASONS.CATEGORY_FALLBACK,
      categoryFallbackUsed: true,
      allowedToExecute: true,
      fallbackNote: 'Degraded deferred BLITZ to IMMEDIATE BLITZ because neither TURBO nor DIGITAL was available',
    };
  }

  // Abstain from trade
  return {
    emittedCategory: normEmitted,
    executionCategory: null,
    executionMode: 'DEFERRED',
    waitOffset,
    structure,
    session,
    remapReason: ROUTING_REASONS.CATEGORY_FALLBACK,
    categoryFallbackUsed: true,
    allowedToExecute: false,
    fallbackNote: 'Abstained: neither TURBO nor DIGITAL available to absorb deferred entry, and immediate fallback disabled/unavailable',
  };
}

module.exports = {
  ASSET_CATEGORIES,
  ROUTING_REASONS,
  routeExecutionCategory,
};
