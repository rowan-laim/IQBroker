const { INSTRUMENT_TYPE } = require('../protocol/constants');
const { displayNameForActive, cleanLabel } = require('./methods/actives');

const ALLOWED_CATEGORIES = Object.freeze(['forex', 'crypto', 'stock', 'commodity', 'index', 'etf']);

const CATEGORY_ALIASES = Object.freeze({
  currency: 'forex',
  currencies: 'forex',
  cryptocurrency: 'crypto',
  cryptocurrencies: 'crypto',
  stocks: 'stock',
  share: 'stock',
  shares: 'stock',
  equity: 'stock',
  equities: 'stock',
  commodities: 'commodity',
  indices: 'index',
  indexes: 'index',
  etfs: 'etf',
});

function normalizeCategoryName(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw)
    .toLowerCase()
    .replace(/^front\./, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+otc$/, '')
    .trim();
  const compact = s.replace(/\s+/g, '');
  if (ALLOWED_CATEGORIES.includes(compact)) return compact;
  if (CATEGORY_ALIASES[compact]) return CATEGORY_ALIASES[compact];
  if (ALLOWED_CATEGORIES.includes(s)) return s;
  if (CATEGORY_ALIASES[s]) return CATEGORY_ALIASES[s];
  for (const key of ALLOWED_CATEGORIES) {
    if (compact.includes(key) || s.includes(key)) return key;
  }
  for (const [alias, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (compact.includes(alias) || s.includes(alias)) return canonical;
  }
  return null;
}

const PRODUCT = Object.freeze({
  turbo: INSTRUMENT_TYPE.TURBO,
  binary: INSTRUMENT_TYPE.BINARY,
  blitz: INSTRUMENT_TYPE.BLITZ,
  digital: INSTRUMENT_TYPE.DIGITAL,
});

function instrumentTypesForProducts(products) {
  return (products || []).map((product) => PRODUCT[product]).filter(Boolean);
}

function payoutPercent(active) {
  const commission = active?.option?.profit?.commission;
  return Number.isFinite(commission) ? 100 - commission : null;
}

function dedupeToHighestPayout(byProduct) {
  const bestByActiveId = new Map();
  for (const [product, list] of byProduct) {
    for (const item of list) {
      const current = bestByActiveId.get(item.activeId);
      const payout = item.payoutPercent ?? -Infinity;
      if (!current || payout > current.payoutPercent) {
        bestByActiveId.set(item.activeId, { product, payoutPercent: payout });
      }
    }
  }
  const deduped = new Map();
  for (const [product, list] of byProduct) {
    deduped.set(product, list.filter((item) => bestByActiveId.get(item.activeId)?.product === product));
  }
  return deduped;
}

function cleanSymbolName(str) {
  if (!str) return '';
  return String(str).replace(/^front\./i, '').replace(/-op$/i, '').trim();
}

function compactBareName(value) {
  const cleaned = cleanSymbolName(value)
    .replace(/\s*\(\s*OTC\s*\)\s*/ig, '')
    .replace(/[-_\s]OTC$/i, '')
    .replace(/\//g, '')
    .replace(/\s+/g, '');
  if (!cleaned || /^otc$/i.test(cleaned)) return '';
  return cleaned;
}

const FOREX_PAIR_RE = /^(EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY|NOK|SEK|SGD|HKD|ZAR|MXN|TRY|PLN)(EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY|NOK|SEK|SGD|HKD|ZAR|MXN|TRY|PLN)/i;
const CRYPTO_RE = /BTC|ETH|XRP|LTC|DOGE|ADA|SOL|DOT|AVAX|MATIC|BNB|LINK|UNI|ATOM|NEAR|APT|ARB|SHIB|PEPE|TON|TRX|XLM|BCH|ETC|FIL|ICP|AAVE|MKR|DYDX/i;
const COMMODITY_RE = /XAU|XAG|XPT|XPD|USO|UKO|BRENT|WTI|NATGAS|OIL|GOLD|SILVER|COPPER|NGAS/i;
const INDEX_RE = /SPX|NDX|DJI|DAX|FTSE|NKY|NIKKEI|HSI|CAC|US500|US100|US30|GER40|UK100|JPN225|EUROSTOXX/i;
const ETF_RE = /^(SPY|QQQ|IWM|DIA|EEM|EFA|GLD|SLV|TLT|UVXY|VXX)/i;

function bareSymbol(active) {
  for (const field of [active?.ticker, active?.name, active?.description, active?.underlying]) {
    const compact = compactBareName(field);
    if (compact) return compact;
  }
  return '';
}

function inferCategoryFromName(active) {
  const symbol = bareSymbol(active);
  if (!symbol) return null;
  if (ETF_RE.test(symbol)) return 'etf';
  if (INDEX_RE.test(symbol)) return 'index';
  if (COMMODITY_RE.test(symbol)) return 'commodity';
  if (CRYPTO_RE.test(symbol)) return 'crypto';
  if (FOREX_PAIR_RE.test(symbol)) return 'forex';
  return null;
}

function categoryFromGroupLabel(raw) {
  const category = normalizeCategoryName(raw);
  if (category) return category;
  if (raw == null || raw === '') return null;
  const s = String(raw).toLowerCase().replace(/^front\./, '');
  if (/crypto/.test(s)) return 'crypto';
  if (/commodit/.test(s)) return 'commodity';
  if (/indic/.test(s)) return 'index';
  if (/\betf\b/.test(s)) return 'etf';
  if (/(forex|currency)/.test(s) && !/crypto/.test(s)) return 'forex';
  if (/equit|stock|share|industrial|health|technology|consumer|utilit|financial|material|energy|telecom|real estate|bond/.test(s)) {
    return 'stock';
  }
  return null;
}

function categoryFromGroupId(active, groups) {
  if (!groups || typeof groups !== 'object') return null;
  const gid = active?.group_id ?? active?.active_group_id;
  if (gid == null) return null;
  const raw = groups[gid] ?? groups[String(gid)];
  return categoryFromGroupLabel(raw);
}

function classifyActiveCategory(active, categoryIndex = null, groups = null) {
  const id = active?.id ?? active?.active_id;
  if (categoryIndex && id != null && categoryIndex.has(id)) return categoryIndex.get(id);
  const fields = [active?.group_name, active?.active_type, active?.type, active?.group, active?.image];
  for (const field of fields) {
    if (typeof field === 'number') continue;
    const category = normalizeCategoryName(field);
    if (category) return category;
  }
  const fromGroup = categoryFromGroupId(active, groups);
  if (fromGroup) return fromGroup;
  return inferCategoryFromName(active);
}

function indexToCategoryMap(indexPayload) {
  const map = new Map();
  const root = indexPayload?.result && typeof indexPayload.result === 'object'
    ? indexPayload.result
    : indexPayload;
  if (!root || typeof root !== 'object') return map;
  for (const [key, ids] of Object.entries(root)) {
    const category = normalizeCategoryName(key);
    if (!category || !Array.isArray(ids)) continue;
    for (const id of ids) {
      const numeric = Number(id);
      map.set(Number.isFinite(numeric) ? numeric : id, category);
    }
  }
  return map;
}

function allowedCategorySet(config) {
  return new Set(config?.assets?.categories || []);
}

function mergeDigitalUnderlyings(initialization, underlyings, digitalParams) {
  if (!initialization || !underlyings?.underlying) return initialization;
  const commissions = new Map((digitalParams?.commissions || []).map((row) => [row.active_id, row.value]));
  initialization.digital = initialization.digital || { actives: {} };
  for (const underlying of underlyings.underlying) {
    const id = underlying.active_id;
    if (!id) continue;
    if (underlying.is_enabled === false || underlying.enabled === false) continue;
    const existing = initialization.digital.actives[id] || {};
    const commission = commissions.get(id) ?? existing?.option?.profit?.commission ?? 13;
    const rawName = underlying.underlying || existing.name || existing.ticker || String(id);
    initialization.digital.actives[id] = {
      ...existing,
      id,
      name: cleanSymbolName(rawName),
      ticker: cleanSymbolName(underlying.underlying || rawName),
      description: cleanLabel(underlying.description) || existing.description,
      is_otc: existing.is_otc ?? underlying.is_otc,
      enabled: existing.enabled !== false,
      is_suspended: Boolean(existing.is_suspended || underlying.is_suspended),
      is_open: existing.is_open ?? underlying.is_open,
      group_id: existing.group_id ?? underlying.active_group_id ?? underlying.group_id,
      active_type: existing.active_type ?? underlying.active_type,
      type: existing.type ?? underlying.active_type,
      minimal_bet: existing.minimal_bet || 1,
      precision: existing.precision || 6,
      option: { profit: { commission }, expiration_times: existing.option?.expiration_times || [] },
      schedule: findActiveSchedule(existing, initialization) || findActiveSchedule(underlying, initialization) || [],
    };
  }
  return initialization;
}

function findActiveSchedule(active, initPayload = null) {
  if (Array.isArray(active?.schedule) && active.schedule.length > 0) return active.schedule;
  if (Array.isArray(active?.option?.schedule) && active.option.schedule.length > 0) return active.option.schedule;
  if (initPayload && active?.id) {
    for (const prod of ['turbo', 'binary', 'blitz', 'digital']) {
      const other = initPayload[prod]?.actives?.[active.id];
      if (Array.isArray(other?.schedule) && other.schedule.length > 0) return other.schedule;
      if (Array.isArray(other?.option?.schedule) && other.option.schedule.length > 0) return other.option.schedule;
    }
  }
  return null;
}

function scheduleRangeBounds(range) {
  if (Array.isArray(range) && range.length >= 2) {
    return { startSec: Number(range[0]), endSec: Number(range[1]) };
  }
  if (range && typeof range === 'object') {
    return {
      startSec: Number(range.open ?? range.start ?? range.from),
      endSec: Number(range.close ?? range.end ?? range.to),
    };
  }
  return { startSec: NaN, endSec: NaN };
}

function parseAssetSchedule(active, nowSec = Math.floor(Date.now() / 1000), initPayload = null) {
  if (!active || active.enabled === false || active.is_enabled === false || active.is_suspended || active.is_open === false) {
    return { isClosed: true, closeAtSec: null, timeUntilCloseSec: 0 };
  }
  const schedule = findActiveSchedule(active, initPayload);
  if (!schedule || !schedule.length) {
    return { isClosed: false, closeAtSec: null, timeUntilCloseSec: Infinity };
  }
  let isClosed = true;
  let closeAtSec = null;
  let timeUntilCloseSec = Infinity;

  for (const range of schedule) {
    const { startSec, endSec } = scheduleRangeBounds(range);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    if (nowSec >= startSec && nowSec <= endSec) {
      isClosed = false;
      closeAtSec = endSec;
      timeUntilCloseSec = endSec - nowSec;
      break;
    }
  }

  if (isClosed) {
    return { isClosed: true, closeAtSec: null, timeUntilCloseSec: 0 };
  }

  return { isClosed: false, closeAtSec, timeUntilCloseSec };
}

function flattenTradeableUniverse(byProduct) {
  const all = [];
  const seen = new Set();
  if (!byProduct) return all;
  for (const list of byProduct.values()) {
    for (const item of list) {
      if (seen.has(item.activeId)) continue;
      seen.add(item.activeId);
      all.push(item);
    }
  }
  return all;
}

function selectTradeableAssets(init, config = {}, cooldownActiveIds = null, categoryIndex = null, minTimeRemainingSec = 60, nowSec = Math.floor(Date.now() / 1000)) {
  const assetsCfg = config.assets || {};
  const allowedIds = new Set((assetsCfg.ids || []).map(String));
  const allowedCategories = allowedCategorySet(config);
  const products = config.products || ['turbo', 'binary', 'blitz', 'digital'];
  const groups = init?.groups || null;
  const stake = config.stake ?? 10;
  const minPayout = assetsCfg.minPayoutPercent ?? 0;
  const byProduct = new Map(products.map((product) => [product, []]));

  for (const product of products) {
    const actives = init?.[product]?.actives || {};
    for (const active of Object.values(actives)) {
      const payout = payoutPercent(active);
      if (!active?.id || active.enabled === false || active.is_enabled === false || active.is_suspended || active.is_open === false || active.option?.enabled === false || (active.minimal_bet && active.minimal_bet > stake)) continue;
      const sched = parseAssetSchedule(active, nowSec, init);
      if (sched.isClosed || (sched.timeUntilCloseSec != null && sched.timeUntilCloseSec < minTimeRemainingSec)) continue;
      if (allowedIds.size && !allowedIds.has(String(active.id))) continue;
      if (payout != null && payout < minPayout) continue;
      if (cooldownActiveIds && cooldownActiveIds.has(active.id)) continue;
      const category = classifyActiveCategory(active, categoryIndex, groups);
      if (allowedCategories.size && (!category || !allowedCategories.has(category))) continue;
      byProduct.get(product).push({
        activeId: active.id,
        product,
        category,
        instrumentType: PRODUCT[product],
        symbol: displayNameForActive(active, active.id),
        precision: active.precision ?? 6,
        payoutPercent: payout,
        minimumStake: active.minimal_bet,
        availableDurations: active.option?.expiration_times || [],
        closeAtSec: sched.closeAtSec,
        timeUntilCloseSec: sched.timeUntilCloseSec,
        raw: active,
      });
    }
  }
  return dedupeToHighestPayout(byProduct);
}

module.exports = {
  PRODUCT,
  selectTradeableAssets,
  parseAssetSchedule,
  findActiveSchedule,
  scheduleRangeBounds,
  flattenTradeableUniverse,
  instrumentTypesForProducts,
  classifyActiveCategory,
  indexToCategoryMap,
  mergeDigitalUnderlyings,
  normalizeCategoryName,
};
