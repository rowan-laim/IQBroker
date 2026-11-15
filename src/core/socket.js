/**
 * IQSocket — low-level transport for the Quadcode WS protocol.
 *
 * Single source of truth for connection, reconnect/backoff, and request correlation.
 * Frame handling is O(1) via Map keyed by request_id.
 */
const WebSocket = require('ws');
const { EventEmitter } = require('events');
const { createLogger } = require('./logger');

const DEFAULT_URL = 'wss://ws.iqoption.com/echo/websocket';
const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

class AuthenticationError extends Error {
  constructor(message = 'authentication failed: ssid rejected') {
    super(message);
    this.name = 'AuthenticationError';
    this.code = 'AUTH_FAILED';
  }
}

function isAuthenticationError(err) {
  return Boolean(
    err &&
    (err instanceof AuthenticationError ||
      err.code === 'AUTH_FAILED' ||
      err.name === 'AuthenticationError')
  );
}

/** IQ Option replies `{ name: "authenticated", msg: true|false }`. */
function isAuthSuccess(msg) {
  if (msg === true) return true;
  if (msg === false || msg == null) return false;
  if (typeof msg === 'object') {
    if (msg.authenticated === true || msg.success === true) return true;
    if (msg.authenticated === false || msg.success === false) return false;
  }
  return false;
}

class IQSocket extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} [opts.url]
   * @param {string} [opts.ssid] - session id from HTTP login (may be empty; IQClient.refreshSsid fills it)
   * @param {import('./logger').Logger} [opts.logger]
   */
  constructor({ url = DEFAULT_URL, ssid, logger } = {}) {
    super();
    this.setMaxListeners(0);
    this.url = url;
    this.ssid = ssid || '';
    this.log = logger || createLogger('socket');

    this.ws = null;
    this.connected = false;
    this.authenticated = false;

    this._reqCounter = 0;
    this._subCounter = 0;
    this._pending = new Map(); // request_id -> { resolve, reject, timer }
    this._activeSubscriptions = new Map(); // key -> { streamName, params, opts }
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._manualClose = false;
    this._authRequestId = null;
    this._authFailed = false;
  }

  setSsid(ssid) {
    if (!ssid) throw new Error('IQSocket requires an ssid');
    this.ssid = ssid;
  }

  _detachSocket() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    if (this._cancelConnect) {
      const cancel = this._cancelConnect;
      this._cancelConnect = null;
      cancel(new Error('socket connection replaced'));
    }
    try { ws.removeAllListeners(); } catch (_) { /* ignore */ }
    try { ws.on('error', () => {}); } catch (_) { /* ignore */ }
    try {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      } else if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch (_) { /* ignore */ }
  }

  // ---- lifecycle ---------------------------------------------------------

  connect({ reconnected = false, notifyAuthFailed = reconnected } = {}) {
    this._manualClose = false;
    this._authFailed = false;
    this._detachSocket();
    if (!this.ssid) {
      const err = new AuthenticationError('authentication failed: no ssid');
      this._authFailed = true;
      if (notifyAuthFailed) this.emit('authFailed', err);
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        if (this._cancelConnect === cancelConnect) this._cancelConnect = null;
        fn(value);
      };
      const cancelConnect = (err) => settle(reject, err);
      this._cancelConnect = cancelConnect;

      this.ws.once('open', async () => {
        this.connected = true;
        this._reconnectAttempt = 0;
        this.log.info('connected', this.url);
        try {
          await this._authenticate();
          this.emit('ready', { reconnected });
          settle(resolve);
        } catch (err) {
          if (notifyAuthFailed) this.emit('authFailed', err);
          settle(reject, err);
        }
      });

      this.ws.on('message', (raw) => this._onMessage(raw));

      this.ws.on('close', (code) => {
        this.connected = false;
        this.authenticated = false;
        const authPending = this._authRequestId && this._pending.has(this._authRequestId);
        if (authPending) {
          const err = code === 1000
            ? new AuthenticationError(`authentication failed: ssid rejected (socket closed ${code})`)
            : new Error(`socket closed during authentication (${code})`);
          this._rejectPending(this._authRequestId, err);
        } else {
          this._rejectAllPending(new Error(`socket closed (${code})`));
        }
        if (code === 1006) {
          this.log.debug('socket connection dropped (1006)');
        } else {
          this.log.warn('closed', code);
        }
        this.emit('disconnected', code);
        if (this._authFailed) return;
        if (!this._manualClose) this._scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.log.error('socket error', err.message);
        this.emit('socketError', err);
        if (!this.connected) settle(reject, err);
      });
    });
  }

  close() {
    this._manualClose = true;
    this._detachSocket();
  }

  /** Fail every in-flight call immediately so callers don't sit on the timeout. */
  _rejectAllPending(err) {
    for (const [request_id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this._pending.delete(request_id);
    }
  }

  _scheduleReconnect() {
    if (this._authFailed || this._manualClose) return;
    this._reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (this._reconnectAttempt - 1),
      RECONNECT_MAX_MS
    );
    this.log.info(`reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect({ reconnected: true }).catch((err) => {
        if (isAuthenticationError(err)) this.log.warn(err.message);
        else this.log.error('reconnect failed', err.message);
      });
    }, delay);
  }

  async _authenticate() {
    const request_id = String(++this._reqCounter);
    this._authRequestId = request_id;
    try {
      const reply = await this._track(
        request_id,
        () => this.send({
          name: 'authenticate',
          msg: { ssid: this.ssid, protocol: 3 },
          request_id,
        }),
        REQUEST_TIMEOUT_MS,
        'authenticate'
      );
      if (!isAuthSuccess(reply)) {
        throw new AuthenticationError('authentication failed: ssid rejected');
      }
    } catch (err) {
      if (isAuthenticationError(err)) {
        this._authFailed = true;
        this.log.warn(err.message);
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.close(); } catch (_) { /* ignore */ }
      }
      throw err;
    } finally {
      this._authRequestId = null;
    }
    this.authenticated = true;
    this.send({ name: 'setOptions', msg: { sendResults: true } });
    this.send({ name: 'setLang', msg: { lang: 'en_US' } });

    this._startHeartbeat();
    this._resubscribeAll();
  }

  _startHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        if (typeof this.ws.ping === 'function') {
          this.ws.ping();
        } else {
          this.send({ name: 'heartbeat' });
        }
      } catch (_) {}
    }, 15000);
  }

  _resubscribeAll() {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const [key, sub] of this._activeSubscriptions) {
      try {
        const request_id = `s_${++this._subCounter}`;
        const msg = { name: sub.streamName, params: sub.params };
        if (sub.opts?.version != null) msg.version = sub.opts.version;
        this.send({ name: 'subscribeMessage', request_id, msg });
        this.log.debug('re-subscribed stream', sub.streamName);
      } catch (err) {
        this.log.warn('re-subscribe failed', sub.streamName, err.message);
      }
    }
  }

  // ---- outbound -----------------------------------------------------------

  send(envelope) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('socket not open');
    }
    const frame = { local_time: Date.now() & 0xffffffff, ...envelope };
    this.ws.send(JSON.stringify(frame));
    return frame;
  }

  call(name, body = {}, opts = {}) {
    const { version = '1.0', raw = false, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
    const request_id = String(++this._reqCounter);

    const envelope = raw
      ? { name, msg: body, request_id }
      : { name: 'sendMessage', request_id, msg: { name, version, body } };

    return this._track(request_id, () => this.send(envelope), timeoutMs, name);
  }

  subscribe(streamName, params = {}, opts = {}) {
    const key = `${streamName}:${JSON.stringify(params)}`;
    this._activeSubscriptions.set(key, { streamName, params, opts });

    const { version = '1.0' } = opts;
    const request_id = `s_${++this._subCounter}`;
    const msg = { name: streamName, params };
    if (version != null) msg.version = version;
    this.send({ name: 'subscribeMessage', request_id, msg });
    return request_id;
  }

  unsubscribe(streamName, params = {}, opts = {}) {
    const key = `${streamName}:${JSON.stringify(params)}`;
    this._activeSubscriptions.delete(key);

    const { version = '1.0' } = opts;
    const request_id = `u_${++this._subCounter}`;
    const msg = { name: streamName, params };
    if (version != null) msg.version = version;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return request_id;
    this.send({ name: 'unsubscribeMessage', request_id, msg });
    return request_id;
  }

  _track(request_id, doSend, timeoutMs = REQUEST_TIMEOUT_MS, name = 'unknown') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this._pending.get(request_id);
        if (!pending) return;
        this._pending.delete(request_id);
        if (pending.ackFrame?.msg && pending.ackFrame.msg.success !== false) {
          pending.resolve(pending.ackFrame.msg);
        } else {
          pending.reject(new Error(`request ${request_id} (${name}) timed out`));
        }
      }, timeoutMs);

      this._pending.set(request_id, { resolve, reject, timer, ackFrame: null });
      try {
        doSend();
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(request_id);
        reject(err);
      }
    });
  }

  _resolvePending(request_id, value) {
    const pending = this._pending.get(request_id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pending.delete(request_id);
    pending.resolve(value);
  }

  _rejectPending(request_id, err) {
    const pending = this._pending.get(request_id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pending.delete(request_id);
    pending.reject(err);
  }

  // ---- inbound ------------------------------------------------------------

  _onMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch (err) {
      this.log.warn('failed to parse frame', raw.toString().slice(0, 200));
      return;
    }

    this.emit('frame', frame);

    const { name } = frame;
    const request_id = frame.request_id != null && frame.request_id !== ''
      ? String(frame.request_id)
      : undefined;

    if (name === 'authenticated') {
      this._handleAuthenticated(frame, request_id);
      return;
    }

    if (!request_id || !this._pending.has(request_id)) {
      if (name) this.emit(`push:${name}`, frame.msg, frame);
      return;
    }

    const pending = this._pending.get(request_id);

    if (name === 'result') {
      pending.ackFrame = frame;
      if (frame.msg && frame.msg.success === false) {
        const reason =
          frame.msg.reason ||
          frame.msg.message ||
          frame.msg.error ||
          JSON.stringify(frame.msg);
        this._rejectPending(request_id, new Error(`request ${request_id} failed: ${reason}`));
        return;
      }
      return;
    }

    this._resolvePending(request_id, frame.msg);
  }

  _handleAuthenticated(frame, request_id) {
    const ok = isAuthSuccess(frame.msg);
    const pendingId = (request_id && this._pending.has(request_id))
      ? request_id
      : (this._authRequestId && this._pending.has(this._authRequestId) ? this._authRequestId : null);

    if (!ok) {
      const err = new AuthenticationError('authentication failed: ssid rejected');
      this._authFailed = true;
      if (pendingId) this._rejectPending(pendingId, err);
      return;
    }
    if (pendingId) this._resolvePending(pendingId, frame.msg);
  }
}

module.exports = {
  IQSocket,
  DEFAULT_URL,
  AuthenticationError,
  isAuthenticationError,
  isAuthSuccess,
};
