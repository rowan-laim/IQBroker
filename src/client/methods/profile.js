const { METHOD, STREAM } = require('../../protocol/constants');

const BALANCE_CHANGED_STREAMS = Object.freeze([
  STREAM.BALANCE_CHANGED,
  STREAM.INTERNAL_BILLING_BALANCE_CHANGED,
]);

const BALANCE_REQUEST_TIMEOUT_MS = 3_000;
const BALANCE_RETRY_DELAY_MS = 150;

function isTransientBalanceError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /timeout|timed out|network|socket|connection|closed|econn|temporar|unavailable/.test(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapBalances(reply) {
  if (Array.isArray(reply)) return reply;
  if (Array.isArray(reply?.items)) return reply.items;
  if (Array.isArray(reply?.balances)) return reply.balances;
  if (Array.isArray(reply?.result)) return reply.result;
  if (Array.isArray(reply?.result?.items)) return reply.result.items;
  return [];
}

function extractBalancePayload(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const nested = msg.current_balance || msg.balance || msg.currentBalance
    || msg.data?.current_balance || msg.data?.balance
    || msg.result?.current_balance || msg.result?.balance || msg;
  if (!nested || typeof nested !== 'object') return null;
  const id = nested.id ?? nested.user_balance_id ?? nested.balance_id
    ?? msg.user_balance_id ?? msg.balance_id ?? msg.id;
  const amountRaw = nested.amount ?? nested.cash ?? nested.available
    ?? nested.enrolled_amount ?? msg.amount ?? msg.cash ?? msg.available;
  const amount = Number(amountRaw);
  const out = { ...nested };
  if (id != null) out.id = id;
  const type = nested.type ?? nested.balance_type ?? msg.type ?? msg.balance_type;
  if (type != null) out.type = type;
  if (Number.isFinite(amount)) out.amount = amount;
  return out;
}

function pickBalance(balances, { id, type } = {}) {
  const list = unwrapBalances(balances);
  const matches = list.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (id != null) return Number(item.id) === Number(id);
    if (type != null) return Number(item.type) === Number(type);
    return false;
  });
  if (!matches.length) return null;
  // Prefer fiat, then the funded wallet
  matches.sort((a, b) => {
    const fiat = Number(Boolean(b.is_fiat)) - Number(Boolean(a.is_fiat));
    if (fiat) return fiat;
    return Number(b.amount || 0) - Number(a.amount || 0);
  });
  return matches[0];
}

function createProfileMethods(socket) {
  return {
    _selectedBalance: null,

    getProfile() {
      return socket.call(METHOD.GET_PROFILE);
    },

    /**
     * @returns {Promise<Array<{id:number,type:number,amount:number,currency:string}>>}
     *   type: 1=real, 2=tournament, 4=practice — see BALANCE_TYPE in constants.js
     */
    async getBalances({ timeoutMs = BALANCE_REQUEST_TIMEOUT_MS } = {}) {
      const reply = await socket.call(METHOD.GET_BALANCES, {
        types_ids: [1, 4, 2],
        tournaments_statuses_ids: [3, 2],
      }, { timeoutMs });
      return unwrapBalances(reply);
    },

    /**
     * Selects the balance used for subsequent order payloads.
     */
    async selectBalance({ id, type, timeoutMs = BALANCE_REQUEST_TIMEOUT_MS, retries = 1 } = {}) {
      if (id == null && type == null) throw new Error('selectBalance requires id or type');
      const retryCount = Number.isFinite(Number(retries)) ? Math.max(0, Math.floor(Number(retries))) : 1;
      let balances;
      let lastError;
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
          balances = await this.getBalances({ timeoutMs });
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= retryCount || !isTransientBalanceError(error)) throw error;
          if (typeof socket.connect === 'function') {
            try { await socket.connect({ reconnected: true }); }
            catch (connectError) {
              throw new Error(`Balance request failed (${error.message}); broker reconnect failed (${connectError.message})`);
            }
          }
          await wait(BALANCE_RETRY_DELAY_MS);
        }
      }
      if (!balances) throw lastError || new Error('Could not load broker balances');
      const balance = pickBalance(balances, { id, type });
      if (!balance) throw new Error(`Requested balance was not found (${id != null ? `id=${id}` : `type=${type}`})`);
      this._selectedBalance = balance;
      return balance;
    },

    getSelectedBalance() {
      return this._selectedBalance;
    },

    /**
     * Listen only (no subscribe).
     * @param {(balance: object) => void} onChange
     * @returns {{unsubscribe: () => void}}
     */
    onBalanceChanged(onChange) {
      const handler = (msg) => onChange(extractBalancePayload(msg) || msg);
      for (const name of BALANCE_CHANGED_STREAMS) {
        socket.on(`push:${name}`, handler);
      }
      return {
        unsubscribe: () => {
          for (const name of BALANCE_CHANGED_STREAMS) {
            socket.off(`push:${name}`, handler);
          }
        },
      };
    },

    /**
     * Subscribe to live balance-changed pushes for binary/turbo/practice cash.
     * @param {(balance: object) => void} onChange
     * @returns {{unsubscribe: () => void}}
     */
    subscribeBalanceChanged(onChange) {
      if (typeof onChange !== 'function') {
        throw new Error('subscribeBalanceChanged requires onChange callback');
      }
      if (typeof socket.subscribe === 'function') {
        for (const name of BALANCE_CHANGED_STREAMS) {
          try { socket.subscribe(name, {}, { version: '1.0' }); } catch (_) { /* offline */ }
        }
      }
      const listening = this.onBalanceChanged(onChange);
      return {
        unsubscribe: () => {
          listening.unsubscribe();
          if (typeof socket.unsubscribe !== 'function') return;
          for (const name of BALANCE_CHANGED_STREAMS) {
            try { socket.unsubscribe(name, {}, { version: '1.0' }); } catch (_) { /* ignore */ }
          }
        },
      };
    },
  };
}

module.exports = createProfileMethods;
module.exports.unwrapBalances = unwrapBalances;
module.exports.pickBalance = pickBalance;
module.exports.extractBalancePayload = extractBalancePayload;
module.exports.BALANCE_REQUEST_TIMEOUT_MS = BALANCE_REQUEST_TIMEOUT_MS;
