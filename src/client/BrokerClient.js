const { IQSocket, DEFAULT_URL, AuthenticationError, isAuthenticationError } = require('../core/socket');
const { createLogger } = require('../core/logger');

const profileMethods = require('./methods/profile');
const candleMethods = require('./methods/candles');
const positionMethods = require('./methods/positions');
const optionMethods = require('./methods/options');
const digitalMethods = require('./methods/digitalOptions');
const activeMethods = require('./methods/actives');
const indicatorMethods = require('./methods/indicators');

const METHOD_MODULES = [
  profileMethods,
  candleMethods,
  positionMethods,
  optionMethods,
  digitalMethods,
  activeMethods,
  indicatorMethods,
];

/**
 * BrokerClient (also exported as IQClient)
 *
 * Framework-agnostic client for IQ Option (Quadcode protocol).
 * Provides candle retrieval, trade execution, and balance management.
 */
class BrokerClient {
  /**
   * @param {object} opts
   * @param {string} opts.ssid
   * @param {string} [opts.url]
   * @param {import('../core/logger').Logger} [opts.logger]
   * @param {(info: { previousSsid: string, reason: string }) => Promise<string>} [opts.refreshSsid]
   */
  constructor({ ssid, url = DEFAULT_URL, logger, refreshSsid } = {}) {
    this.log = logger || createLogger('client');
    this.socket = new IQSocket({ ssid, url, logger: this.log.child('socket') });
    this.refreshSsid = refreshSsid;
    this._everReady = false;
    this._reauthInFlight = null;

    this.socket.on('ready', () => { this._everReady = true; });
    this.socket.on('authFailed', (err) => {
      this._reauthenticate(err).catch((e) => {
        this.log.error('reauthentication failed', e.message);
      });
    });

    for (const buildMethods of METHOD_MODULES) {
      Object.assign(this, buildMethods(this.socket));
    }
  }

  async connect() {
    if (!this.socket.ssid && typeof this.refreshSsid === 'function') {
      await this._reauthenticate(new AuthenticationError('authentication failed: no ssid'));
      this.log.info('authenticated and ready');
      return this;
    }
    try {
      await this.socket.connect();
    } catch (err) {
      if (!isAuthenticationError(err)) throw err;
      await this._reauthenticate(err);
    }
    this.log.info('authenticated and ready');
    return this;
  }

  async _reauthenticate(err) {
    if (this._reauthInFlight) return this._reauthInFlight;
    this._reauthInFlight = this._reauthenticateOnce(err).finally(() => {
      this._reauthInFlight = null;
    });
    return this._reauthInFlight;
  }

  async _reauthenticateOnce(err) {
    const hint = 'Set IQ_EMAIL / IQ_PASSWORD or authenticate via browser to refresh session';
    if (typeof this.refreshSsid !== 'function') {
      throw new AuthenticationError(`${err.message}. ${hint}`);
    }
    const previousSsid = this.socket.ssid;
    this.log.warn(
      previousSsid
        ? 'ssid rejected by server; logging in for a fresh session'
        : 'no ssid configured; requesting a fresh session over HTTP before WebSocket login'
    );
    const next = await this.refreshSsid({ previousSsid, reason: err.message });
    if (!next) {
      throw new AuthenticationError(`authentication failed: ssid refresh returned no session. ${hint}`);
    }
    this.socket.setSsid(next);
    await this.socket.connect({
      reconnected: this._everReady,
      notifyAuthFailed: false,
    });
  }

  disconnect() {
    this.socket.close();
  }

  get connected() {
    return this.socket.connected && this.socket.authenticated;
  }

  get balanceId() {
    return this._selectedBalance?.id;
  }

  raw() {
    return this.socket;
  }
}

// Alias IQClient for backward compatibility
const IQClient = BrokerClient;

module.exports = {
  BrokerClient,
  IQClient,
  AuthenticationError,
  isAuthenticationError,
  ...require('./indicators'),
};
