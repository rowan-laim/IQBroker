const { METHOD, STREAM, INSTRUMENT_TYPE } = require('../../protocol/constants');

const DEFAULT_POSITION_TYPES = [
  INSTRUMENT_TYPE.BINARY,
  INSTRUMENT_TYPE.TURBO,
  INSTRUMENT_TYPE.BLITZ,
  INSTRUMENT_TYPE.DIGITAL,
];

module.exports = (socket) => ({
  /**
   * @param {{userBalanceId:number, instrumentTypes:string[], offset?:number, limit?:number, timeoutMs?:number}} params
   */
  getPositions({ userBalanceId, instrumentTypes, offset = 0, limit = 30, timeoutMs } = {}) {
    if (!userBalanceId || !instrumentTypes?.length) {
      throw new Error('getPositions requires userBalanceId and instrumentTypes');
    }
    const opts = { version: '4.0' };
    if (timeoutMs != null) opts.timeoutMs = timeoutMs;
    return socket.call(
      METHOD.GET_POSITIONS,
      { offset, limit, user_balance_id: userBalanceId, instrument_types: instrumentTypes },
      opts
    );
  },

  /**
   * Deferred / pending orders for a balance.
   * @param {{userBalanceId:number, kind?:string, instrumentTypes?:string[], timeoutMs?:number}} params
   */
  getOrders({ userBalanceId, kind = 'deferred', instrumentTypes, timeoutMs } = {}) {
    if (!userBalanceId) throw new Error('getOrders requires userBalanceId');
    const body = { user_balance_id: userBalanceId, kind };
    if (instrumentTypes?.length) body.instrument_types = instrumentTypes;
    const opts = { version: '2.0' };
    if (timeoutMs != null) opts.timeoutMs = timeoutMs;
    return socket.call(METHOD.GET_ORDERS, body, opts);
  },

  /**
   * Live P/L updates for specific open positions.
   */
  subscribePositions(ids, onUpdate) {
    socket.send({
      name: 'sendMessage',
      request_id: `pos_${Date.now()}`,
      msg: { name: METHOD.SUBSCRIBE_POSITIONS, version: '1.0', body: { frequency: 'frequent', ids } },
    });
    const handler = (msg) => onUpdate(msg);
    socket.on(`push:${STREAM.POSITIONS_STATE}`, handler);
    return { unsubscribe: () => socket.off(`push:${STREAM.POSITIONS_STATE}`, handler) };
  },

  /**
   * Subscribe to portfolio.position-changed for trade settlement.
   *
   * @param {{userId:number, userBalanceId:number, instrumentTypes?:string[]}} params
   * @param {(msg: object) => void} onChange
   * @returns {{unsubscribe: () => void}}
   */
  subscribePositionChanged({ userId, userBalanceId, instrumentTypes = DEFAULT_POSITION_TYPES }, onChange) {
    if (!userId || !userBalanceId) {
      throw new Error('subscribePositionChanged requires userId and userBalanceId');
    }
    if (typeof onChange !== 'function') {
      throw new Error('subscribePositionChanged requires onChange callback');
    }

    const types = instrumentTypes.length ? instrumentTypes : DEFAULT_POSITION_TYPES;
    for (const instrumentType of types) {
      socket.subscribe(
        STREAM.POSITION_CHANGED,
        { routingFilters: { user_id: userId, user_balance_id: userBalanceId, instrument_type: instrumentType } },
        { version: '3.0' }
      );
    }

    const handler = (msg) => onChange(msg);
    socket.on(`push:${STREAM.POSITION_CHANGED_PUSH}`, handler);

    return {
      unsubscribe: () => {
        socket.off(`push:${STREAM.POSITION_CHANGED_PUSH}`, handler);
        for (const instrumentType of types) {
          socket.unsubscribe(
            STREAM.POSITION_CHANGED,
            { routingFilters: { user_id: userId, user_balance_id: userBalanceId, instrument_type: instrumentType } },
            { version: '3.0' }
          );
        }
      },
    };
  },

  onPositionChanged(onChange) {
    const handler = (msg) => onChange(msg);
    socket.on(`push:${STREAM.POSITION_CHANGED_PUSH}`, handler);
    return { unsubscribe: () => socket.off(`push:${STREAM.POSITION_CHANGED_PUSH}`, handler) };
  },

  onOrderChanged(onChange) {
    const handler = (msg) => onChange(msg);
    socket.on(`push:${STREAM.ORDER_CHANGED_PUSH}`, handler);
    return { unsubscribe: () => socket.off(`push:${STREAM.ORDER_CHANGED_PUSH}`, handler) };
  },
});
