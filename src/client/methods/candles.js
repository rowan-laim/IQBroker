const { METHOD, STREAM } = require('../../protocol/constants');

/**
 * Normalizes a raw candle object into a standard OHLC structure.
 * IQ Option natively uses `min`/`max` for low/high and sometimes abbreviated keys `o`, `c`, `h`, `l`.
 * This normalizer ensures `open`, `high`, `low`, `close`, `min`, `max`, `from`, `to`, `time`
 * are ALWAYS populated as finite numbers.
 */
function normalizeCandle(raw, size = null) {
  if (!raw || typeof raw !== 'object') return null;
  const open = Number(raw.open ?? raw.o ?? 0);
  const close = Number(raw.close ?? raw.c ?? open);
  const high = Number(raw.high ?? raw.max ?? raw.h ?? Math.max(open, close));
  const low = Number(raw.low ?? raw.min ?? raw.l ?? Math.min(open, close));
  const from = raw.from != null
    ? Number(raw.from)
    : (raw.time != null ? Math.floor(Number(raw.time) / (Number(raw.time) > 1e11 ? 1000 : 1)) : null);
  const effectiveSize = size != null ? Number(size) : (raw.size != null ? Number(raw.size) : null);
  const to = raw.to != null
    ? Number(raw.to)
    : (from != null && effectiveSize ? from + effectiveSize : null);
  const time = from != null
    ? from * 1000
    : (raw.time != null ? (Number(raw.time) > 1e11 ? Number(raw.time) : Number(raw.time) * 1000) : Date.now());

  return {
    ...raw,
    id: raw.id ?? (from != null ? from : undefined),
    time,
    from,
    to,
    open,
    high,
    low,
    close,
    min: low,
    max: high,
    volume: raw.volume != null && Number.isFinite(Number(raw.volume)) ? Number(raw.volume) : 0,
    active_id: raw.active_id != null ? Number(raw.active_id) : undefined,
    size: effectiveSize ?? undefined,
  };
}

/**
 * Extracts raw candles array from diverse broker reply envelopes.
 */
function extractCandles(res) {
  if (Array.isArray(res)) return res;
  if (!res || typeof res !== 'object') return [];
  if (Array.isArray(res.candles)) return res.candles;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.result?.candles)) return res.result.candles;
  if (Array.isArray(res.msg?.candles)) return res.msg.candles;
  return [];
}

/**
 * Normalizes an array of raw candle frames.
 */
function normalizeCandles(raw, size = null) {
  const list = extractCandles(raw);
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => normalizeCandle(c, size))
    .filter(Boolean)
    .sort((a, b) => (a.time || 0) - (b.time || 0));
}

function buildCandleMethods(socket) {
  return {
    /**
     * Historical candles.
     * When `count` is specified without explicit `to` or `toId`, automatically anchors
     * `to` to the current UTC timestamp (seconds) so the broker returns the latest window.
     * Returns a normalized array with `.candles` and `.data` aliases for backward compatibility.
     */
    async getCandles({ activeId, size, fromId, toId, count, to, from, onlyClosed = true }) {
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

      const effectiveTo = to !== undefined
        ? to
        : (count !== undefined && toId === undefined ? Math.floor(Date.now() / 1000) : undefined);
      if (effectiveTo !== undefined) body.to = effectiveTo;
      if (from !== undefined) body.from = from;

      const raw = await socket.call(METHOD.GET_CANDLES, body, { version: '2.0' });
      const normalized = normalizeCandles(raw, size);

      // Attach backward-compatibility properties so both array and object property callers work
      normalized.candles = normalized;
      normalized.data = normalized;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        normalized.raw = raw;
      }
      return normalized;
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
     * Callback receives normalized candle with `open`, `high`, `low`, `close`, `min`, `max`.
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
        const normalized = normalizeCandle(msg, size);
        onCandle(normalized);
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
  };
}

buildCandleMethods.normalizeCandle = normalizeCandle;
buildCandleMethods.normalizeCandles = normalizeCandles;
buildCandleMethods.extractCandles = extractCandles;

module.exports = buildCandleMethods;
