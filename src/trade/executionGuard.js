/**
 * Execution Guard
 *
 * Wraps a single broker "place" call and forces the caller to deal with
 * three distinct outcomes instead of the old binary "it threw / it didn't":
 *
 *   CONFIRMED — broker returned a usable id. Safe to record as an open trade.
 *   REJECTED  — broker explicitly said no (thrown error that isn't a
 *               timeout, or a 200-ish response carrying an error/rejection
 *               shape). Never recorded.
 *   UNCERTAIN — the call timed out/socket-closed, or resolved with neither
 *               an id nor a clear error. The trade may or may not have
 *               opened server-side. Never recorded as a trade by this
 *               module — the caller must resolve it via tradeRecovery
 *               (matching getPositions/getOrders) before it can count.
 *
 * This is what stops a 0-duration (or otherwise rejected) trade from
 * silently becoming a counted, "open" local trade: recordPlacement is
 * simply never reachable from a REJECTED or unresolved UNCERTAIN result.
 */

const { isUncertainPlaceError, extractPlaceId } = require('./tradeRecovery');

const OUTCOME = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  UNCERTAIN: 'UNCERTAIN',
});

/**
 * Best-effort detection of an explicit broker rejection carried in a
 * resolved (non-throwing) response, e.g. `{ code: 'invalid_expiration' }`
 * or `{ success: false, message: 'duration too short' }`.
 */
function isExplicitRejection(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.success === false) return true;
  if (res.status === 'error' || res.result === 'error') return true;
  const code = res.code ?? res.result?.code ?? res.error?.code;
  if (code != null && /error|reject|invalid|fail/i.test(String(code))) return true;
  const msg = String(res.message || res.error?.message || res.result?.message || '').toLowerCase();
  if (msg && /reject|invalid|fail|not allowed|too short|expired|out of range/i.test(msg)) return true;
  return false;
}

/**
 * placeFn: () => Promise<brokerResponse>
 * onUncertain: optional (err) => Promise<recoveredResponse|null>, called
 *   only for timeout-shaped errors, to attempt a tradeRecovery match.
 */
async function guardedPlace(placeFn, { label = 'trade', onUncertain } = {}) {
  let res;
  try {
    res = await placeFn();
  } catch (err) {
    if (isUncertainPlaceError(err)) {
      const recovered = typeof onUncertain === 'function' ? await onUncertain(err) : null;
      if (recovered) {
        return { outcome: OUTCOME.CONFIRMED, res: recovered, placeId: extractPlaceId(recovered), recovered: true };
      }
      return { outcome: OUTCOME.UNCERTAIN, error: err };
    }
    return { outcome: OUTCOME.REJECTED, error: err };
  }

  if (isExplicitRejection(res)) {
    return { outcome: OUTCOME.REJECTED, res };
  }

  const placeId = extractPlaceId(res);
  if (placeId == null) {
    // No id, no explicit error shape — ambiguous. Treat as uncertain
    // rather than assuming success. This is the other half of the
    // original bug: a reply with no id used to sail straight into
    // recordPlacement() as if it were a confirmed fill.
    const recovered = typeof onUncertain === 'function' ? await onUncertain(null) : null;
    if (recovered) {
      return { outcome: OUTCOME.CONFIRMED, res: recovered, placeId: extractPlaceId(recovered), recovered: true };
    }
    return { outcome: OUTCOME.UNCERTAIN, res };
  }

  return { outcome: OUTCOME.CONFIRMED, res, placeId };
}

module.exports = { OUTCOME, isExplicitRejection, guardedPlace };
