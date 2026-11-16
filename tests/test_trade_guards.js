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
const { OrderIdGenerator } = require('../src/trade/orderIdGenerator');

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
  testOrderIdGenerator();
  console.log('All trade guard tests PASSED! ✅\n');
}

// 3. OrderIdGenerator Tests
function testOrderIdGenerator() {
  const gen = new OrderIdGenerator({ startCounter: 100, prefix: 'A' });

  const id1 = gen.next();
  const id2 = gen.next();
  const id3 = gen.next();

  // Format: 1 uppercase letter + 3 digits + 2 uppercase letters = 6 chars
  assert.match(id1, /^[A-Z]\d{3}[A-Z]{2}$/, `ID1 format wrong: ${id1}`);
  assert.match(id2, /^[A-Z]\d{3}[A-Z]{2}$/, `ID2 format wrong: ${id2}`);
  assert.match(id3, /^[A-Z]\d{3}[A-Z]{2}$/, `ID3 format wrong: ${id3}`);

  // Numeric part must increment: A100** → A101** → A102**
  assert.ok(id1.startsWith('A100'), `Expected A100**, got ${id1}`);
  assert.ok(id2.startsWith('A101'), `Expected A101**, got ${id2}`);
  assert.ok(id3.startsWith('A102'), `Expected A102**, got ${id3}`);

  // Suffix is always 2 uppercase letters
  assert.match(id1.slice(4), /^[A-Z]{2}$/, `Suffix wrong: ${id1.slice(4)}`);

  // Prefix rollover: A999 → B100
  const rollGen = new OrderIdGenerator({ startCounter: 999, prefix: 'A' });
  const a999 = rollGen.next(); // A999**
  const b100 = rollGen.next(); // B100**
  assert.ok(a999.startsWith('A999'), `Expected A999**, got ${a999}`);
  assert.ok(b100.startsWith('B100'), `Expected B100**, got ${b100}`);

  // All 26 prefix letters cycle
  const cycleGen = new OrderIdGenerator({ startCounter: 999, prefix: 'Z' });
  cycleGen.next(); // Z999**
  const a100again = cycleGen.next(); // A100** (Z → A wrap)
  assert.ok(a100again.startsWith('A100'), `Expected Z→A wrap, got ${a100again}`);

  console.log(`  ✅ OrderIdGenerator verified: ${id1} → ${id2} → ${id3}, rollover ${a999} → ${b100}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
