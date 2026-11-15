const assert = require('node:assert/strict');
const {
  assertValidExpiry,
  resolveDurationMs,
  InvalidDurationError,
} = require('../src/trade/durationGuard');
const {
  guardedPlace,
  isExplicitRejection,
  OUTCOME,
} = require('../src/trade/executionGuard');

console.log('Testing Broker Trade Safety Guards...');

// 1. Duration Guard Tests
function testDurationGuard() {
  const now = 1_000_000;
  // Valid future expiry (60 seconds out)
  const validExpiry = 1000 + 60; // 1060s => 1,060,000ms
  assertValidExpiry(validExpiry, { now, minDurationMs: 5000 });

  // Expired in past
  assert.throws(
    () => assertValidExpiry(999, { now, minDurationMs: 5000 }),
    (err) => err instanceof InvalidDurationError && /sub-minimum|past|expired/i.test(err.message)
  );

  // 0 or NaN expiry
  assert.throws(
    () => assertValidExpiry(0, { now, minDurationMs: 5000 }),
    InvalidDurationError
  );
  assert.throws(
    () => assertValidExpiry(NaN, { now, minDurationMs: 5000 }),
    InvalidDurationError
  );

  // Sub-minimum duration (2 seconds when 5s is minimum)
  assert.throws(
    () => assertValidExpiry(1002, { now, minDurationMs: 5000 }),
    InvalidDurationError
  );

  console.log('  ✅ Duration guard (0-duration & past-expiry prevention) verified');
}

// 2. Execution Guard Tests
async function testExecutionGuard() {
  // CONFIRMED
  const confirmedRes = await guardedPlace(async () => ({ id: 12345, active_id: 76 }));
  assert.equal(confirmedRes.outcome, OUTCOME.CONFIRMED);
  assert.equal(confirmedRes.placeId, 12345);

  // REJECTED (via error)
  const rejectedErrRes = await guardedPlace(async () => {
    throw new Error('invalid expiration time');
  });
  assert.equal(rejectedErrRes.outcome, OUTCOME.REJECTED);

  // REJECTED (via response payload)
  const rejectedPayloadRes = await guardedPlace(async () => ({
    success: false,
    message: 'Stake out of range',
  }));
  assert.equal(rejectedPayloadRes.outcome, OUTCOME.REJECTED);

  // UNCERTAIN (via timeout)
  const timeoutRes = await guardedPlace(async () => {
    throw new Error('request pos_123 timed out after 10000ms');
  });
  assert.equal(timeoutRes.outcome, OUTCOME.UNCERTAIN);

  console.log('  ✅ Execution guard (CONFIRMED/REJECTED/UNCERTAIN classification) verified');
}

async function run() {
  testDurationGuard();
  await testExecutionGuard();
  console.log('All trade guard tests PASSED! ✅\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
