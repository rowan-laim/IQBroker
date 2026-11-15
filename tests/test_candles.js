const assert = require('node:assert/strict');
const { normalizeCandle, normalizeCandles, extractCandles } = require('../index.js');

console.log('Testing candle normalization and helpers...');

// 1. Test normalizeCandle with raw IQ Option payload (min / max)
const rawPush = {
  active_id: 76,
  size: 60,
  id: 1001,
  from: 1700000000,
  to: 1700000060,
  open: 1.097385,
  close: 1.097375,
  min: 1.097350,
  max: 1.097400,
  volume: 42,
};

const normalized = normalizeCandle(rawPush, 60);
assert.equal(normalized.open, 1.097385, 'Open mapped');
assert.equal(normalized.close, 1.097375, 'Close mapped');
assert.equal(normalized.high, 1.097400, 'High derived from max');
assert.equal(normalized.low, 1.097350, 'Low derived from min');
assert.equal(normalized.max, 1.097400, 'Max preserved');
assert.equal(normalized.min, 1.097350, 'Min preserved');
assert.equal(normalized.from, 1700000000, 'From mapped');
assert.equal(normalized.to, 1700000060, 'To mapped');
assert.equal(normalized.time, 1700000000000, 'Time in ms computed');
console.log('  ✅ normalizeCandle correctly maps min/max to low/high');

// 2. Test extractCandles from diverse envelopes
const directArray = [{ open: 1, close: 2, min: 1, max: 2, from: 100 }];
const wrappedCandles = { candles: directArray };
const wrappedData = { data: directArray };
const wrappedResult = { result: { candles: directArray } };

assert.equal(extractCandles(directArray).length, 1);
assert.equal(extractCandles(wrappedCandles).length, 1);
assert.equal(extractCandles(wrappedData).length, 1);
assert.equal(extractCandles(wrappedResult).length, 1);
assert.equal(extractCandles(null).length, 0);
console.log('  ✅ extractCandles unwraps all known broker formats');

// 3. Test normalizeCandles
const rawBatch = {
  candles: [
    { from: 200, open: 2, close: 3, min: 1.9, max: 3.1 },
    { from: 100, open: 1, close: 2, min: 0.9, max: 2.1 },
  ],
};
const batchNormalized = normalizeCandles(rawBatch, 60);
assert.equal(batchNormalized.length, 2);
assert.equal(batchNormalized[0].from, 100, 'Sorted ascending by time');
assert.equal(batchNormalized[0].high, 2.1, 'High mapped');
assert.equal(batchNormalized[0].low, 0.9, 'Low mapped');
assert.equal(batchNormalized[1].from, 200);

console.log('  ✅ normalizeCandles sorts and normalizes batch');
console.log('All candle tests PASSED! ✅');
