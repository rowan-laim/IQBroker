/**
 * Browser-Assisted Session Capture Example
 *
 * Demonstrates launching a browser via Playwright, capturing the session token
 * (SSID) from cookies or CDP WebSocket frames, saving it to .env, and
 * reusing it headlessly.
 *
 * Usage:
 *   node examples/browser-session.js
 */
const { captureBrowserSession, BrokerClient } = require('../index');

async function main() {
  console.log('--- Browser-Assisted Session Capture ---');

  try {
    const session = await captureBrowserSession({
      headless: false, // Visible browser so user can log in or solve 2FA/captcha
      saveToEnv: true, // Automatically writes IQ_SSID into .env
      timeoutMs: 60_000,
    });

    console.log(`✅ Session captured successfully: ${session.ssid.slice(0, 8)}...`);

    // Verify connection with captured token
    console.log('Verifying session with headless WebSocket connection...');
    const client = new BrokerClient({ ssid: session.ssid });
    await client.connect();

    const profile = await client.getProfile();
    console.log(`✅ Headless connection verified! Logged in as: ${profile?.name || 'Trader'}`);

    client.disconnect();
    await session.close();
    console.log('Browser closed cleanly.');
  } catch (err) {
    console.error('Session capture error:', err.message);
  }
}

if (require.main === module) {
  main();
}
