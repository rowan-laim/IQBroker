const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { IQSocket, isAuthenticationError } = require('../src/core/socket');

console.log('Testing Broker IQSocket Protocol...');

async function testEmptySocketConnect() {
  const socket = new IQSocket({ ssid: '', url: 'wss://example.invalid' });
  assert.equal(socket.ssid, '');
  await assert.rejects(
    () => socket.connect(),
    (err) => isAuthenticationError(err) && /no ssid/.test(err.message)
  );
  console.log('  ✅ Empty SSID rejection verified');
}

async function testDetachingConnectingSocketIsSafe() {
  const socket = new IQSocket({ ssid: 'test-ssid', url: 'ws://127.0.0.1:1' });
  const abandoned = new EventEmitter();
  abandoned.readyState = 0; // WebSocket.CONNECTING
  let terminated = false;
  abandoned.terminate = () => {
    terminated = true;
    process.nextTick(() => abandoned.emit('error', new Error('aborted handshake')));
  };
  let connectionError;
  socket.ws = abandoned;
  socket._cancelConnect = (err) => { connectionError = err; };

  socket._detachSocket();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminated, true, 'connecting socket should be terminated');
  assert.match(connectionError.message, /replaced/);
  assert.equal(socket.ws, null);
  console.log('  ✅ Detaching connecting socket safely verified');
}

async function testRequestCorrelation() {
  const socket = new IQSocket({ ssid: 'test-ssid' });
  socket.ws = {
    readyState: 1, // OPEN
    send: (payload) => {
      const frame = JSON.parse(payload);
      // Simulate server response matching request_id
      process.nextTick(() => {
        socket._onMessage(JSON.stringify({
          name: 'profile',
          request_id: frame.request_id,
          msg: { user_id: 999, name: 'TestUser' },
        }));
      });
    },
  };

  const profile = await socket.call('core.get-profile');
  assert.equal(profile.user_id, 999);
  assert.equal(profile.name, 'TestUser');
  console.log('  ✅ Request-response correlation via request_id verified');
}

async function run() {
  await testEmptySocketConnect();
  await testDetachingConnectingSocketIsSafe();
  await testRequestCorrelation();
  console.log('All IQSocket tests PASSED! ✅\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
