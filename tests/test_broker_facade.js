const assert = require('node:assert/strict');
const broker = require('../index.js');

console.log('Testing standalone Broker exports and facade...');

// 1. Verify core exports
assert.equal(typeof broker.BrokerClient, 'function', 'BrokerClient exported');
assert.equal(typeof broker.IQClient, 'function', 'IQClient exported as alias');
assert.equal(broker.BrokerClient, broker.IQClient, 'IQClient is an alias for BrokerClient');
assert.equal(typeof broker.createClient, 'function', 'createClient exported');
assert.equal(typeof broker.loginWithPassword, 'function', 'loginWithPassword exported');
assert.equal(typeof broker.captureBrowserSession, 'function', 'captureBrowserSession exported');
assert.equal(typeof broker.writeSsidToEnvFile, 'function', 'writeSsidToEnvFile exported');
assert.equal(typeof broker.ConnectionLayer, 'function', 'ConnectionLayer exported');
assert.equal(typeof broker.IQSocket, 'function', 'IQSocket exported');
assert.equal(typeof broker.constants, 'object', 'constants exported');
assert.equal(typeof broker.timing, 'object', 'timing exported');
assert.equal(typeof broker.assetFilter, 'object', 'assetFilter exported');
assert.equal(typeof broker.trade, 'object', 'trade exported');

console.log('  ✅ Core module exports verified');

// 2. Client instantiation & method surface
const client = new broker.BrokerClient({ ssid: 'test-ssid' });
const requiredMethods = [
  'connect',
  'disconnect',
  'getProfile',
  'getBalances',
  'selectBalance',
  'getSelectedBalance',
  'subscribeBalanceChanged',
  'onBalanceChanged',
  'getCandles',
  'getFirstCandles',
  'subscribeCandles',
  'subscribeQuotes',
  'getPositions',
  'getOrders',
  'subscribePositions',
  'subscribePositionChanged',
  'onPositionChanged',
  'onOrderChanged',
  'buyTurbo',
  'buyBinary',
  'buyBlitz',
  'sellOptions',
  'rolloverOption',
  'buyDigital',
  'buyDigitalOption',
  'getDigitalInstruments',
  'getDigitalUnderlyings',
  'subscribeDigitalPrice',
  'getActive',
  'getActivesIndex',
  'getInitializationData',
  'resolveActive',
];

for (const m of requiredMethods) {
  assert.equal(typeof client[m], 'function', `BrokerClient must expose method ${m}`);
}
console.log(`  ✅ All ${requiredMethods.length} broker methods verified on client instance`);

// 3. Timing module functions
const nowSec = 1700000000;
const blitzExp = broker.timing.blitzExpiryForDuration(30, nowSec);
assert.equal(blitzExp, nowSec + 30, 'Blitz expiry is exactly now + duration');
const binExp = broker.timing.binaryExpiryForDuration(60, nowSec);
assert.ok(binExp > nowSec + 60, 'Binary expiry jumps to next window + duration');
console.log('  ✅ Timing & expiry calculations verified');

// 4. Trade guards export
assert.equal(typeof broker.trade.executeTrade, 'function', 'executeTrade exported');
assert.equal(typeof broker.trade.TradeManager, 'function', 'TradeManager exported');
assert.equal(typeof broker.trade.assertValidExpiry, 'function', 'assertValidExpiry exported');
assert.equal(typeof broker.trade.guardedPlace, 'function', 'guardedPlace exported');
assert.equal(typeof broker.trade.getPlacer, 'function', 'getPlacer exported');
console.log('  ✅ Trade execution and safety guard exports verified');

console.log('All broker facade tests PASSED! ✅\n');
