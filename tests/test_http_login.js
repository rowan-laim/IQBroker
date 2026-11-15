const assert = require('node:assert/strict');
const {
  loginWithPassword,
  extractSsidFromLoginResponse,
  ssidFromCookieHeader,
  ssidFromBody,
} = require('../src/auth/httpLogin');

console.log('Testing Broker HTTP Login...');

async function testExtractors() {
  assert.equal(
    ssidFromCookieHeader('ssid=abc123def456; Domain=.iqoption.com; Path=/'),
    'abc123def456'
  );
  assert.equal(
    ssidFromCookieHeader('other=val; ssid=cookie789; Path=/'),
    'cookie789'
  );
  assert.equal(ssidFromBody({ result: { ssid: 'from-json' } }), 'from-json');
  assert.equal(ssidFromBody({ token: 'direct-token' }), 'direct-token');
  console.log('  ✅ Cookie and JSON SSID extractors verified');
}

async function testCredentialValidation() {
  await assert.rejects(
    () => loginWithPassword({ email: '', password: 'pwd' }),
    /IQ_EMAIL and IQ_PASSWORD/
  );
  await assert.rejects(
    () => loginWithPassword({ email: 'user@test.com', password: '' }),
    /IQ_EMAIL and IQ_PASSWORD/
  );
  console.log('  ✅ Missing credential rejection verified');
}

async function testSuccessfulLoginMock() {
  const mockFetch = async (url, opts) => {
    return {
      status: 200,
      headers: {
        getSetCookie: () => ['ssid=mocked-session-token; Path=/; Domain=.iqoption.com'],
        get: () => 'ssid=mocked-session-token; Path=/',
      },
      text: async () => JSON.stringify({ code: 'success', data: { ssid: 'mocked-session-token' } }),
    };
  };

  const ssid = await loginWithPassword({
    email: 'user@test.com',
    password: 'password123',
    fetchImpl: mockFetch,
  });

  assert.equal(ssid, 'mocked-session-token');
  console.log('  ✅ Mocked HTTP login flow verified');
}

async function run() {
  await testExtractors();
  await testCredentialValidation();
  await testSuccessfulLoginMock();
  console.log('All HTTP login tests PASSED! ✅\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
