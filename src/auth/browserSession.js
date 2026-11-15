/**
 * Browser Session Capture for IQ Option.
 *
 * Attaches Playwright to a Chromium browser session, navigates to the
 * IQ Option Traderoom, and taps the session token (SSID) from cookies or
 * raw WebSocket authentication frames via Chrome DevTools Protocol (CDP).
 *
 * Use this when:
 *   - The account requires 2FA or captcha that headless HTTP login cannot bypass.
 *   - You want to extract an active browser session token to reuse headlessly.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_TRADEROOM_URL = 'https://iqoption.com/traderoom';
const DEFAULT_PROFILE_DIR = '.browser-profile';

function maskSsid(ssid) {
  if (!ssid || ssid.length < 10) return '(short/empty)';
  return `${ssid.slice(0, 6)}…${ssid.slice(-4)}`;
}

/**
 * Saves or updates an IQ_SSID entry in a .env file.
 */
function writeSsidToEnvFile(ssid, envFilePath = path.join(process.cwd(), '.env')) {
  let content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  if (/^IQ_SSID=/m.test(content)) {
    content = content.replace(/^IQ_SSID=.*$/m, `IQ_SSID=${ssid}`);
  } else {
    if (content.length && !content.endsWith('\n')) content += '\n';
    content += `\n# Captured IQ Option session token\nIQ_SSID=${ssid}\n`;
  }
  fs.writeFileSync(envFilePath, content, 'utf8');
  process.env.IQ_SSID = ssid;
}

/**
 * Captures an authenticated SSID by launching Chromium via Playwright.
 *
 * @param {object} [opts]
 * @param {string} [opts.email] - Optional email to auto-fill into login form
 * @param {string} [opts.password] - Optional password to auto-fill into login form
 * @param {string} [opts.traderoomUrl] - Traderoom URL (default: https://iqoption.com/traderoom)
 * @param {string} [opts.profileDir] - Browser profile directory for persistent cookies
 * @param {boolean} [opts.headless=false] - Run headless or with visible browser window
 * @param {number} [opts.timeoutMs=60000] - Maximum time to wait for login/SSID
 * @param {boolean} [opts.saveToEnv=false] - Automatically update .env file
 * @param {string} [opts.envPath] - Path to .env file
 * @returns {Promise<{ ssid: string, close: () => Promise<void> }>}
 */
async function captureBrowserSession(opts = {}) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (_) {
    throw new Error(
      'Playwright is required for browser session capture. Run: npm install playwright'
    );
  }

  const { chromium } = playwright;
  const traderoomUrl = opts.traderoomUrl || process.env.IQ_TRADEROOM_URL || DEFAULT_TRADEROOM_URL;
  const profileDir = path.resolve(process.cwd(), opts.profileDir || process.env.BROWSER_PROFILE_DIR || DEFAULT_PROFILE_DIR);
  const headless = opts.headless ?? (process.env.HEADLESS === 'true');
  const timeoutMs = opts.timeoutMs || 120_000;
  const email = opts.email || process.env.IQ_EMAIL;
  const password = opts.password || process.env.IQ_PASSWORD;

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: headless ? { width: 1280, height: 720 } : null,
  });

  const page = context.pages()[0] || (await context.newPage());

  let capturedSsid = null;
  let resolveSsid, rejectSsid;
  const ssidPromise = new Promise((resolve, reject) => {
    resolveSsid = resolve;
    rejectSsid = reject;
  });

  const timeoutTimer = setTimeout(() => {
    rejectSsid(new Error(`Timed out waiting for browser session after ${timeoutMs}ms`));
  }, timeoutMs);

  function onFoundSsid(ssid) {
    if (capturedSsid) return;
    capturedSsid = ssid;
    clearTimeout(timeoutTimer);
    if (opts.saveToEnv) {
      try {
        writeSsidToEnvFile(ssid, opts.envPath);
      } catch (err) {
        console.warn('[browserSession] Failed to write SSID to .env:', err.message);
      }
    }
    resolveSsid({
      ssid,
      close: async () => {
        try { await context.close(); } catch (_) {}
      },
    });
  }

  // 1. Check existing cookies from persistent profile first
  try {
    const cookies = await context.cookies('https://iqoption.com');
    const hit = cookies.find((c) => c.name === 'ssid' && c.value);
    if (hit) {
      onFoundSsid(hit.value);
    }
  } catch (_) {}

  // 2. Attach Chrome DevTools Protocol to tap WebSocket frames
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');

    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      let payload = response?.payloadData;
      try { payload = JSON.parse(payload); } catch (_) {}
      if (
        payload &&
        typeof payload === 'object' &&
        payload.name === 'authenticate' &&
        payload.msg?.ssid
      ) {
        onFoundSsid(payload.msg.ssid);
      }
    });

    cdp.on('Network.responseReceivedExtraInfo', ({ headers }) => {
      const setCookie = headers?.['set-cookie'] || headers?.['Set-Cookie'];
      if (setCookie) {
        const match = String(setCookie).match(/(?:^|;\s*)ssid=([^;]+)/i);
        if (match) onFoundSsid(decodeURIComponent(match[1].trim()));
      }
    });
  } catch (err) {
    console.warn('[browserSession] CDP session warning:', err.message);
  }

  // 3. Navigate to traderoom
  await page.goto(traderoomUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // 4. Best-effort credential autofill if inputs are visible
  if (email && password) {
    try {
      await page.waitForTimeout(1500);
      const emailInput = await page.$(
        'input[name="email"], input[type="email"], input[name="username"]'
      );
      const passInput = await page.$('input[name="password"], input[type="password"]');
      if (emailInput && passInput) {
        await emailInput.fill(email);
        await passInput.fill(password);
        const submit = await page.$(
          'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")'
        );
        if (submit) await submit.click();
      }
    } catch (_) {}
  }

  return ssidPromise;
}

module.exports = {
  captureBrowserSession,
  writeSsidToEnvFile,
  maskSsid,
  DEFAULT_TRADEROOM_URL,
  DEFAULT_PROFILE_DIR,
};
