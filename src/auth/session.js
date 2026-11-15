/**
 * Session helper for IQ Option broker client.
 * Handles automatic login via email/password when SSID is missing or expired.
 */
const { BrokerClient, AuthenticationError, isAuthenticationError } = require('../client/BrokerClient');
const { loginWithPassword, DEFAULT_LOGIN_URL, DEFAULT_TIMEOUT_MS } = require('./httpLogin');

function createSsidRefresher(opts = {}) {
  const email = opts.email || process.env.IQ_EMAIL;
  const password = opts.password || process.env.IQ_PASSWORD;
  const url = opts.url || process.env.IQ_LOGIN_URL || DEFAULT_LOGIN_URL;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  return async ({ reason } = {}) => {
    if (!email || !password) {
      throw new AuthenticationError('Cannot refresh session: email and password required');
    }
    if (reason) console.log(`[session] ${reason} — requesting a fresh SSID over HTTP`);
    const ssid = await loginWithPassword({ email, password, url, timeoutMs });
    if (typeof opts.onRefresh === 'function') {
      try { opts.onRefresh(ssid); } catch (_) {}
    }
    return ssid;
  };
}

/**
 * Creates an BrokerClient (IQClient) instance configured with credentials and optional auto-reauthentication.
 *
 * @param {object} [opts]
 * @param {string} [opts.ssid]
 * @param {string} [opts.email]
 * @param {string} [opts.password]
 * @param {string} [opts.url]
 * @param {object} [opts.logger]
 * @param {boolean|function} [opts.autoRefresh=true]
 * @param {function} [opts.onRefresh]
 * @returns {BrokerClient}
 */
function createClient(opts = {}) {
  const email = opts.email || process.env.IQ_EMAIL;
  const password = opts.password || process.env.IQ_PASSWORD;
  const credentialsAvailable = Boolean(email && password);
  if (opts.freshSession === true && !credentialsAvailable) {
    throw new AuthenticationError('The trading client requires IQ_EMAIL and IQ_PASSWORD to request a fresh session; a saved IQ_SSID is not used.');
  }
  const ssid = opts.freshSession === true || (credentialsAvailable && opts.autoRefresh !== false)
    ? ''
    : (opts.ssid || process.env.IQ_SSID || '');
  const url = opts.url || process.env.IQ_WS_URL;
  let refreshSsid = undefined;

  if (opts.autoRefresh !== false && credentialsAvailable) {
    refreshSsid = typeof opts.refreshSsid === 'function'
      ? opts.refreshSsid
      : createSsidRefresher(opts);
  } else if (typeof opts.refreshSsid === 'function') {
    refreshSsid = opts.refreshSsid;
  }

  return new BrokerClient({
    ssid,
    url,
    logger: opts.logger,
    logLevel: opts.logLevel,
    refreshSsid,
  });
}

module.exports = {
  createClient,
  createSsidRefresher,
  loginWithPassword,
  AuthenticationError,
  isAuthenticationError,
};
