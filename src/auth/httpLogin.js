/**
 * Headless HTTP login — email/password in, ssid out.
 *
 * One POST to IQ Option's auth API.
 * The ssid this returns is the same session token the WebSocket
 * `authenticate` frame expects.
 */
const DEFAULT_LOGIN_URL = 'https://auth.iqoption.com/api/v2/login';
const FALLBACK_LOGIN_URLS = [
  'https://auth.iqoption.com/api/v1.0/login',
];
const DEFAULT_TIMEOUT_MS = 10_000;

const LOGIN_HEADERS = Object.freeze({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://login.iqoption.com',
  Referer: 'https://login.iqoption.com/en/login',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
});

function ssidFromCookieHeader(header) {
  if (!header) return null;
  const match = String(header).match(/(?:^|;\s*)ssid=([^;]+)/i)
    || String(header).match(/(?:^|,\s*)ssid=([^;]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

function cookieHeaders(res) {
  if (!res?.headers) return [];
  if (typeof res.headers.getSetCookie === 'function') {
    const list = res.headers.getSetCookie();
    if (Array.isArray(list) && list.length) return list;
  }
  const single = res.headers.get?.('set-cookie');
  return single ? [single] : [];
}

function ssidFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  const direct = body.ssid || body.token || body.result?.ssid || body.data?.ssid;
  return typeof direct === 'string' && direct ? direct : null;
}

function extractSsidFromLoginResponse(res, body) {
  for (const header of cookieHeaders(res)) {
    const ssid = ssidFromCookieHeader(header);
    if (ssid) return ssid;
  }
  return ssidFromBody(body);
}

function isTwoFactor(body) {
  const code = String(body?.code || body?.error || '').toLowerCase();
  const message = String(body?.message || body?.msg || '').toLowerCase();
  return (
    code === '2fa' ||
    code === 'verify' ||
    code === 'two_factor' ||
    code.includes('2fa') ||
    message.includes('two-factor') ||
    message.includes('2fa')
  );
}

function isInvalidCredentials(status, body) {
  if (status === 401 || status === 403) return true;
  const code = String(body?.code || body?.error || '').toLowerCase();
  return (
    code === 'invalid_credentials' ||
    code === 'invalid_identifier' ||
    code === 'wrong_credentials'
  );
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatLoginFailure(status, body, text) {
  if (isTwoFactor(body)) {
    return 'login failed: account requires 2FA (HTTP login cannot complete this session; use browser login)';
  }
  if (isInvalidCredentials(status, body)) {
    return 'login failed: invalid IQ_EMAIL / IQ_PASSWORD';
  }
  const detail =
    (typeof body?.message === 'string' && body.message) ||
    (typeof body?.msg === 'string' && body.msg) ||
    (typeof body?.code === 'string' && body.code) ||
    (text ? text.slice(0, 180) : '');
  return `login failed (${status})${detail ? `: ${detail}` : ''}`;
}

async function postLogin(fetchImpl, url, email, password, timeoutMs) {
  const signal = timeoutMs
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: LOGIN_HEADERS,
    body: JSON.stringify({ identifier: email, password }),
    redirect: 'manual',
    signal,
  });
  const text = await res.text().catch(() => '');
  const body = parseBody(text);
  return { res, body, text };
}

/**
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.password
 * @param {string} [opts.url]
 * @param {number} [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<string>} ssid
 */
async function loginWithPassword({
  email,
  password,
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!email || !password) {
    throw new Error('headless login needs IQ_EMAIL and IQ_PASSWORD in .env');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('headless login needs fetch (Node 18+)');
  }

  const urls = [...new Set([url || DEFAULT_LOGIN_URL, ...(url && url !== DEFAULT_LOGIN_URL ? [DEFAULT_LOGIN_URL] : []), ...FALLBACK_LOGIN_URLS])];
  let lastError = null;

  for (const endpoint of urls) {
    let result;
    try {
      result = await postLogin(fetchImpl, endpoint, email, password, timeoutMs);
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.code === 'ABORT_ERR') {
        lastError = new Error(`login timed out after ${timeoutMs}ms (${endpoint})`);
        continue;
      }
      lastError = err;
      continue;
    }

    const { res, body, text } = result;
    const ssid = extractSsidFromLoginResponse(res, body);
    if (ssid) return ssid;

    if (res.status === 404 || res.status === 405) {
      lastError = new Error(`login endpoint not found (${res.status}): ${endpoint}`);
      continue;
    }

    throw new Error(formatLoginFailure(res.status, body, text));
  }

  throw lastError || new Error('login failed: no ssid in auth response');
}

module.exports = {
  loginWithPassword,
  extractSsidFromLoginResponse,
  ssidFromCookieHeader,
  ssidFromBody,
  DEFAULT_LOGIN_URL,
  DEFAULT_TIMEOUT_MS,
  LOGIN_HEADERS,
};
