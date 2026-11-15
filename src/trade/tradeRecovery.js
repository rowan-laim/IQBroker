/**
 * Recover a server-side fill when the place call times out or acks without an id.
 *
 * The broker can open the option and still fail to deliver the named "option" /
 * "digital-option-placed" frame before the socket timeout. Callers then have
 * no id, skip recording, and may place again — while position-changed cannot
 * match anything local. Matching getPositions / getOrders / late pushes by
 * active + direction + product + stake + recency closes that gap.
 */
const { INSTRUMENT_TYPE } = require('../protocol/constants');

const PRODUCT_TO_INSTRUMENT = Object.freeze({
  turbo: INSTRUMENT_TYPE.TURBO,
  binary: INSTRUMENT_TYPE.BINARY,
  blitz: INSTRUMENT_TYPE.BLITZ,
  digital: INSTRUMENT_TYPE.DIGITAL,
});

const INSTRUMENT_TO_PRODUCT = Object.freeze({
  [INSTRUMENT_TYPE.TURBO]: 'turbo',
  [INSTRUMENT_TYPE.BINARY]: 'binary',
  [INSTRUMENT_TYPE.BLITZ]: 'blitz',
  [INSTRUMENT_TYPE.DIGITAL]: 'digital',
  turbo: 'turbo',
  binary: 'binary',
  blitz: 'blitz',
  digital: 'digital',
});

function extractPlaceId(res) {
  if (res == null || typeof res !== 'object') return null;
  const id = res.id ?? res.result?.id ?? res.option_id ?? res.position_id ?? res.order_id;
  if (id == null || id === '') return null;
  return id;
}

function isUncertainPlaceError(err) {
  const msg = String(err?.message || err || '');
  return /timed out/i.test(msg) || /socket closed/i.test(msg);
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.positions)) return value.positions;
  if (value.positions && Array.isArray(value.positions.items)) return value.positions.items;
  if (Array.isArray(value.orders)) return value.orders;
  if (value.orders && Array.isArray(value.orders.items)) return value.orders.items;
  if (Array.isArray(value.result)) return value.result;
  if (value.result && typeof value.result === 'object') return asList(value.result);
  return [];
}

function flattenPositions(reply) {
  return asList(reply).filter((row) => row && typeof row === 'object');
}

function nestedRaw(obj) {
  if (!obj?.raw_event || typeof obj.raw_event !== 'object') return null;
  const vals = Object.values(obj.raw_event);
  return vals.find((v) => v && typeof v === 'object') || null;
}

function firstDefined(...vals) {
  for (const v of vals) {
    if (v != null && v !== '') return v;
  }
  return null;
}

function normalizeDirection(value) {
  if (value == null) return null;
  const s = String(value).toLowerCase();
  if (s === 'call' || s === 'buy' || s === '1') return 'call';
  if (s === 'put' || s === 'sell' || s === '-1') return 'put';
  return s;
}

function productFromInstrumentType(type, fallback = null) {
  if (type == null || type === '') return fallback;
  const s = String(type).toLowerCase();
  if (INSTRUMENT_TO_PRODUCT[s]) return INSTRUMENT_TO_PRODUCT[s];
  if (s.includes('blitz')) return 'blitz';
  if (s.includes('turbo')) return 'turbo';
  if (s.includes('digital')) return 'digital';
  if (s.includes('binary')) return 'binary';
  return fallback;
}

function openTimeMs(obj, raw) {
  const v = firstDefined(
    obj?.open_time,
    obj?.openTime,
    obj?.created,
    obj?.create_time,
    obj?.opened_at,
    obj?.open_at,
    raw?.open_time,
    raw?.created,
    raw?.create_time,
    raw?.open_at
  );
  if (v == null) return null;
  if (typeof v === 'string' && Number.isNaN(Number(v))) {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function summarizeServerTrade(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const raw = nestedRaw(obj);
  const instrumentType = firstDefined(
    obj.instrument_type,
    obj.instrumentType,
    raw?.instrument_type,
    obj.type,
    raw?.type
  );
  const product = productFromInstrumentType(instrumentType, productFromInstrumentType(obj.type));
  const activeId = firstDefined(
    obj.active_id,
    obj.activeId,
    obj.act,
    obj.asset_id,
    obj.assetId,
    raw?.active_id,
    raw?.activeId,
    raw?.act,
    raw?.asset_id
  );
  const direction = normalizeDirection(firstDefined(obj.direction, raw?.direction, obj.side, raw?.side));
  const stake = Number(firstDefined(
    obj.invest,
    obj.buy_amount,
    obj.amount,
    obj.price,
    raw?.invest,
    raw?.buy_amount,
    raw?.amount,
    raw?.price
  ));
  const id = firstDefined(
    obj.external_id,
    obj.id,
    obj.option_id,
    obj.position_id,
    raw?.option_id,
    raw?.id,
    raw?.position_id
  );
  const orderId = firstDefined(
    obj.order_id,
    Array.isArray(raw?.order_ids) ? raw.order_ids[0] : null,
    Array.isArray(obj.order_ids) ? obj.order_ids[0] : null,
    raw?.order_id,
    raw?.id
  );
  const positionId = firstDefined(
    obj.position_id,
    raw?.position_id,
    obj.external_id,
    raw?.option_id,
    raw?.id,
    obj.id
  );
  const instrumentId = firstDefined(obj.instrument_id, obj.instrumentId, raw?.instrument_id);
  const status = String(firstDefined(obj.status, raw?.status) || '').toLowerCase();

  return {
    id: id != null ? id : null,
    orderId: orderId != null ? orderId : null,
    positionId: positionId != null ? positionId : null,
    externalId: firstDefined(obj.external_id, id),
    activeId: activeId != null ? Number(activeId) : null,
    direction,
    product,
    instrumentType: instrumentType != null ? String(instrumentType) : null,
    instrumentId: instrumentId != null ? String(instrumentId) : null,
    stake: Number.isFinite(stake) ? stake : null,
    openedAt: openTimeMs(obj, raw),
    status: status || null,
    raw: obj,
  };
}

function matchesIntent(intent, found, { now = Date.now(), alreadyTracked } = {}) {
  if (!intent || !found) return false;
  if (found.id == null && found.orderId == null && found.positionId == null) return false;
  if (found.activeId != null && Number(found.activeId) !== Number(intent.activeId)) return false;
  if (intent.direction && found.direction && found.direction !== intent.direction) return false;
  if (intent.product && found.product && found.product !== intent.product) return false;
  if (intent.instrumentId && found.instrumentId && String(found.instrumentId) !== String(intent.instrumentId)) {
    return false;
  }
  if (Number.isFinite(Number(intent.stake)) && Number.isFinite(found.stake)
    && Math.abs(found.stake - Number(intent.stake)) > 0.05) {
    return false;
  }
  if (found.status && found.status !== 'open' && found.status !== 'pending' && found.status !== 'filled') {
    return false;
  }
  if (typeof alreadyTracked === 'function') {
    const ids = [found.id, found.orderId, found.positionId, found.externalId].filter((x) => x != null);
    if (ids.some((id) => alreadyTracked(id))) return false;
  }
  const openedAt = found.openedAt;
  if (Number.isFinite(openedAt) && Number.isFinite(Number(intent.startedAt))) {
    if (openedAt < Number(intent.startedAt) - 5_000) return false;
    if (openedAt > now + 5_000) return false;
  }
  return true;
}

function pickBestMatch(intent, candidates, opts) {
  const hits = (candidates || [])
    .map(summarizeServerTrade)
    .filter((row) => matchesIntent(intent, row, opts));
  if (!hits.length) return null;
  hits.sort((a, b) => (Number(b.openedAt) || 0) - (Number(a.openedAt) || 0));
  return hits[0];
}

function toRecoveredPlaceReply(found) {
  if (!found) return null;
  const id = found.orderId ?? found.id ?? found.positionId;
  return {
    id,
    position_id: found.positionId ?? found.id,
    order_id: found.orderId ?? null,
    external_id: found.externalId ?? found.id,
    _recovered: true,
    _recoverySource: found.status ? `server:${found.status}` : 'server',
  };
}

function awaitingServerId(trade) {
  if (!trade) return false;
  if (trade.unconfirmed) return true;
  return trade.orderId == null && trade.positionId == null;
}

module.exports = {
  PRODUCT_TO_INSTRUMENT,
  extractPlaceId,
  isUncertainPlaceError,
  flattenPositions,
  summarizeServerTrade,
  matchesIntent,
  pickBestMatch,
  toRecoveredPlaceReply,
  awaitingServerId,
};
