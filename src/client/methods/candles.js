const { METHOD, STREAM } = require('../../protocol/constants');

module.exports = (socket) => ({
  /**
   * Historical candles. `fromId`/`toId` are server-assigned candle indices,
   * not timestamps — get a starting point from getFirstCandles() or from a
   * live candle-generated push (msg.id).
   */
  getCandles({ activeId, size, fromId, toId, count, to, from, onlyClosed = true }) {
    if (!activeId || !size) throw new Error('getCandles requires activeId and size');
    const body = {
      active_id: activeId,
      size,
      split_normalization: true,
      only_closed: onlyClosed,
    };
    if (fromId !== undefined) body.from_id = fromId;
    if (toId !== undefined) body.to_id = toId;
    if (count !== undefined) body.count = count;
    if (to !== undefined) body.to = to;
    if (from !== undefined) body.from = from;

    return socket.call(METHOD.GET_CANDLES, body, { version: '2.0' });
  },

  /**
   * First known candle id per size for an active. Wire body is just
   * `{ active_id, split_normalization }` (no `size`) at version 1.0 —
   * the reply is `{ candles_by_size: { "1": {...}, "5": {...}, ... } }`.
   */
  getFirstCandles({ activeId, splitNormalization = true }) {
    if (!activeId) throw new Error('getFirstCandles requires activeId');
    return socket.call(
      METHOD.GET_FIRST_CANDLES,
      { active_id: activeId, split_normalization: splitNormalization },
      { version: '1.0' }
    );
  },

  /**
   * Live candle stream for one instrument/timeframe.
   * Callback receives the raw push plus stable identity fields:
   *   { active_id, size, id, open, close, ... }
   *
   * @param {{activeId:number, size:number}} params
   * @param {(candle: object) => void} onCandle
   * @returns {{unsubscribe: () => void}}
   */
  subscribeCandles({ activeId, size }, onCandle) {
    if (!activeId || !size) throw new Error('subscribeCandles requires activeId and size');
    const routingFilters = { active_id: activeId, size };
    socket.subscribe(STREAM.CANDLE_GENERATED, { routingFilters }, { version: null });

    const handler = (msg) => {
      if (!msg || Number(msg.active_id) !== Number(activeId) || Number(msg.size) !== Number(size)) return;
      onCandle(msg);
    };
    socket.on(`push:${STREAM.CANDLE_GENERATED}`, handler);

    return {
      unsubscribe: () => {
        socket.off(`push:${STREAM.CANDLE_GENERATED}`, handler);
        socket.unsubscribe(STREAM.CANDLE_GENERATED, { routingFilters }, { version: null });
      },
    };
  },

  /**
   * Live tick stream for one active. Carries `value` / `ask` / `bid` — the
   * `value` field (float) is what you scale into open-option's integer `value`
   * via `toWireValue(quote, precision)`.
   *
   * @param {{activeId:number}} params
   * @param {(tick: object) => void} onTick
   * @returns {{unsubscribe: () => void}}
   */
  subscribeQuotes({ activeId }, onTick) {
    if (!activeId) throw new Error('subscribeQuotes requires activeId');
    const numericActiveId = Number(activeId);
    const routingFilters = { active_id: numericActiveId };
    socket.subscribe(STREAM.CANDLES_GENERATED, { routingFilters }, { version: null });

    const handler = (msg) => {
      if (!msg || Number(msg.active_id) !== numericActiveId) return;
      onTick(msg);
    };
    socket.on(`push:${STREAM.CANDLES_GENERATED}`, handler);

    return {
      unsubscribe: () => {
        socket.off(`push:${STREAM.CANDLES_GENERATED}`, handler);
        socket.unsubscribe(STREAM.CANDLES_GENERATED, { routingFilters }, { version: null });
      },
    };
  },
});
