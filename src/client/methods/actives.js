const { METHOD } = require('../../protocol/constants');

const FOREX_CCY = 'EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY|NOK|SEK|SGD|HKD|ZAR|MXN|TRY|PLN|AED|INR|BRL|CLP|COP|IDR|EGP|MYR|PHP|PKR|SAR|THB|VND|RUB|CNH|CNY|KRW|ILS|CZK|HUF|RON|PEN|ARS|NGN|DOP|BOB|BDT';
const QUOTE_CCY = 'USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD|USDT|USDC|AED|PHP|BRL|INR|BTC|ETH';
const FIAT_QUOTE_CCY = 'USD|USDT|USDC|EUR|GBP|JPY|AUD|CAD|CHF|NZD|AED|PHP|BRL|INR';
const FOREX_PAIR_NAME_RE = new RegExp(`^(${FOREX_CCY})(${FOREX_CCY})$`, 'i');
const QUOTED_PAIR_NAME_RE = new RegExp(`^([A-Z]{2,20})(${QUOTE_CCY})$`, 'i');
const FOREX_CCY_RE = new RegExp(`^(${FOREX_CCY})$`, 'i');
const FIAT_QUOTE_RE = new RegExp(`^(${FIAT_QUOTE_CCY})$`, 'i');
const OTC_ONLY_RE = /^[-_\s(]*otc[-_\s)]*$/i;
const SPOT_INDEX_LABEL_RE = /\bspot\s+index$/i;
const INDEX_CODE_RE = /^[A-Z]+\d+$/;

// Client short names for crypto coins. Never use backend tickers 
// (DOGEUSD-OTC becomes "Dogecoin (OTC)", XPDUSD-OTC becomes "Palladium (OTC)").
const CRYPTO_SHORT_NAMES = Object.freeze({
  XPD: 'Palladium',
  XPT: 'Platinum',
  DOT: 'Polkadot',
  ADA: 'Cardano',
  SOL: 'Solana',
  DOGE: 'Dogecoin',
  SHIB: 'Shiba Inu',
  MATIC: 'Polygon',
  AVAX: 'Avalanche',
  LUNA: 'Terra',
  LUNC: 'Terra Classic',
  ATOM: 'Cosmos',
  ALGO: 'Algorand',
  APE: 'ApeCoin',
  AXS: 'Axie Infinity',
  EGLD: 'Elrond',
  FTM: 'Fantom',
  ICP: 'Internet Computer',
  KSM: 'Kusama',
  NEAR: 'NEAR Protocol',
  QNT: 'Quant',
  RUNE: 'THORChain',
  SAND: 'The Sandbox',
  STX: 'Stacks',
  THETA: 'Theta Network',
  XLM: 'Stellar Lumens',
  XMR: 'Monero',
  XRP: 'Ripple',
  ZEC: 'Zcash',
  PENGU: 'Pudgy Penguins',
  HYPE: 'Hype',
  PEPE: 'Pepe',
  PEPE2: 'Pepe 2.0',
  RENDER: 'Render'





  
});

// Client short names as used in the traderoom (OTC wire keys like JP225-OTC,
// plus pair legs like US100/JP225). Never use backend tickers (NKY, DAX, SPX).
const INDEX_SHORT_NAMES = Object.freeze({
  JAPAN225: 'JP 225',
  JP225: 'JP 225',
  GERMANY30: 'GER 30',
  GER30: 'GER 30',
  FRANCE40: 'FR 40',
  FR40: 'FR 40',
  SPAIN35: 'SP 35',
  SP35: 'SP 35',
  SPX: 'S&P 500',
  HONGKONG33: 'HK 33',
  HK33: 'HK 33',
  EURO50: 'EU 50',
  EU50: 'EU 50',
  USSPX500: 'US 500',
  US500: 'US 500',
  SP500: 'S&P 500',
  USNDAQ100: 'US 100',
  US100: 'US 100',
  US30: 'US 30',
  UK100: 'UK 100',
  AUS200: 'AUS 200',
  US2000: 'US 2000',
});

const CLIENT_BRAND_TOKENS = Object.freeze({
  ishares: 'iShares',
  vaneck: 'VanEck',
  proshares: 'ProShares',
  ultrapro: 'UltraPro',
  ultrashort: 'UltraShort',
  spdr: 'SPDR',
  's&p': 'S&P',
  's&p500': 'S&P500',
  etf: 'ETF',
  qqq: 'QQQ',
});

// Client short names for commodities. Never use backend tickers 
// (COTTONUSD-OTC becomes "Cotton (OTC)", COCOAUSD-OTC becomes "Cocoa (OTC)").
const COMODITY_SHORT_NAMES = Object.freeze({
  COTTON: 'Cotton',
  COCOA: 'Cocoa',
  SUGAR: 'Sugar',
  COFFEE: 'Coffee',
  WHEAT: 'Wheat',
  CORN: 'Corn',
  SOYBEAN: 'Soybean',
  OIL: 'Crude Oil',
  BRENT: 'Brent Oil',
  NATGAS: 'Natural Gas',
  GASOLINE: 'Gasoline',
  HEATOIL: 'Heating Oil',
});

// Client-facing labels for metals. Backend tickers leak as pair legs (XAUUSD -> "Gold", XAGUSD -> "Silver").
// Standalone metals still use INDEX_SHORT_NAMES 
// with otc extension if otc or just the metal name (XAUUSD-OTC → "Gold (OTC)").
const METAL_DISPLAY_NAMES = Object.freeze({
  XAU: 'Gold',
  XAG: 'Silver',
  GOLD: 'Gold',
  SILVER: 'Silver',
});

// Backend tickers that leak as pair legs (SPX/Gold, NKY, DAX). Standalone
// indices still use INDEX_SHORT_NAMES (USSPX500 → "US 500").
const LEG_DISPLAY_NAMES = Object.freeze({
  SPX: 'S&P 500',
  'S&P': 'S&P 500',
  SAndP: 'S&P 500',
  NDX: 'US 100',
  NKY: 'JP 225',
  DAX: 'GER 30',
  INDU: 'US 30',
  HSI: 'HK 33',
  IBEX: 'SP 35',
  CAC: 'FR 40',
  UKX: 'UK 100',
  SX5E: 'EU 50',
  AS51: 'AUS 200',
});

/**
 * Strip localization prefixes the web client leaves on some name fields
 * (e.g. "front.EURUSD-OTC" → "EURUSD-OTC", "front.EUR/USD (OTC)" → "EUR/USD (OTC)").
 */
function cleanLabel(value) {
  if (value == null) return null;
  let s = String(value).replace(/^front\./i, '').replace(/^exchange_/i, '').trim();
  // Strip duplicated leading ticker prefix (e.g., "MSFT Microsoft Corporation" →
  // "Microsoft Corporation"). Do not strip all-caps brands like "SPDR ... ETF".
  const match = s.match(/^[A-Z]{2,5}\s+([A-Z][a-zA-Z0-9\s.,&'-]+)$/);
  if (match && /[a-z]/.test(match[1])) s = match[1];
  return s || null;
}

function isOtcOnlyLabel(value) {
  return Boolean(value) && OTC_ONLY_RE.test(String(value).trim());
}

/** Client-facing labels look like "EUR/USD (OTC)" or "Apple" — not wire keys. */
function looksLikeClientDisplayName(value) {
  const s = cleanLabel(value);
  if (!s || isOtcOnlyLabel(s)) return false;
  return /[/\s(]/.test(s);
}

function hasOtcMarker(active, value) {
  if (active?.is_otc) return true;
  const s = String(value || '').trim();
  if (!s) return false;
  return /[-_\s]OTC$/i.test(s) || /\(\s*OTC\s*\)/i.test(s) || OTC_ONLY_RE.test(s);
}

function stripOtcMarker(value) {
  return String(value || '')
    .replace(/\s*\(\s*OTC\s*\)\s*/ig, ' ')
    .replace(/[-_\s]OTC$/i, '')
    .trim();
}

function stripSpotIndexMarker(value) {
  return String(value || '').replace(/:N$/i, '').trim();
}

function stripInstrumentSuffixes(value) {
  return stripSpotIndexMarker(stripOtcMarker(String(value || '')))
    .replace(/-op$/i, '')
    .trim();
}

function activeIsOtc(active, extra = null) {
  if (active?.is_otc) return true;
  const fields = [extra, active?.name, active?.description, active?.display_name, active?.underlying];
  return fields.some((field) => {
    const cleaned = cleanLabel(field);
    return cleaned && !isOtcOnlyLabel(cleaned) && hasOtcMarker(active, field);
  });
}

function applyOtcSuffix(label, active, extra = null) {
  if (!label) return label;
  const body = String(label).replace(/\s*\(\s*OTC\s*\)$/i, '').trim();
  if (activeIsOtc(active, extra) || /\(\s*OTC\s*\)$/i.test(label)) return `${body} (OTC)`;
  return body;
}

function isSpotIndexLabel(value) {
  return Boolean(value) && SPOT_INDEX_LABEL_RE.test(String(value).trim());
}

function compactIndexCode(value) {
  return stripSpotIndexMarker(stripOtcMarker(cleanLabel(value) || ''))
    .replace(/\s+/g, '')
    .toUpperCase();
}

function formatIndexToken(value) {
  const compact = compactIndexCode(value);
  if (!compact) return null;
  if (INDEX_SHORT_NAMES[compact]) return INDEX_SHORT_NAMES[compact];
  if (!INDEX_CODE_RE.test(compact)) return null;
  const match = compact.match(/^([A-Z]+)(\d+)$/);
  return match ? `${match[1]} ${match[2]}` : null;
}

function displayLeg(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '').replace(/:N$/i, '').toUpperCase();
  if (METAL_DISPLAY_NAMES[compact]) return METAL_DISPLAY_NAMES[compact];
  const indexName = formatIndexToken(compact);
  if (indexName) return indexName;
  if (/^[A-Za-z]{2,6}$/.test(raw)) return raw.toUpperCase();
  return raw;
}

/**
 * Traderoom short names: JP225-OTC / JAPAN225:N → "JP 225".
 * Slash index pairs are handled by formatPairLabel.
 */
function formatIndexDisplayName(value, active) {
  const raw = cleanLabel(value);
  if (!raw || isOtcOnlyLabel(raw)) return null;
  if (stripInstrumentSuffixes(raw).includes('/')) return null;
  const formatted = formatIndexToken(raw);
  if (!formatted) return null;
  return applyOtcSuffix(formatted, active, raw);
}

function isAllCapsPhrase(value) {
  const s = String(value || '').trim();
  if (!s || s.includes('/') || !/\s/.test(s)) return false;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase();
}

function titleCaseClientLabel(value) {
  return String(value)
    .split(/(\s+)/)
    .map((token) => {
      if (!token || /^\s+$/.test(token)) return token;
      const lower = token.toLowerCase();
      if (CLIENT_BRAND_TOKENS[lower]) return CLIENT_BRAND_TOKENS[lower];
      if (!/[A-Za-z]/.test(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join('');
}

function formatPairLabel(value) {
  const raw = cleanLabel(value);
  if (!raw || isOtcOnlyLabel(raw)) return null;
  const body = stripInstrumentSuffixes(raw);
  if (!body) return null;

  if (body.includes('/')) {
    const parts = body.split('/').map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) return null;
    const left = displayLeg(parts[0]);
    const right = displayLeg(parts[1]);
    if (!left || !right) return null;
    // The OTC qualifier applies to the combined index cross, never to each
    // component. Preserve the traderoom's spaced notation for index crosses
    // while retaining conventional compact FX/crypto pair formatting.
    const indexCross = Boolean(formatIndexToken(parts[0]) && formatIndexToken(parts[1]));
    return indexCross ? `${left} / ${right}` : `${left}/${right}`;
  }

  const compact = body.replace(/\s+/g, '');
  const forex = compact.match(FOREX_PAIR_NAME_RE);
  if (forex) return `${displayLeg(forex[1])}/${displayLeg(forex[2])}`;
  const quoted = compact.match(QUOTED_PAIR_NAME_RE);
  if (quoted) return `${displayLeg(quoted[1])}/${displayLeg(quoted[2])}`;
  return null;
}

function pairFromSides(active) {
  const left = cleanLabel(active?.currency_left_side);
  const right = cleanLabel(active?.currency_right_side);
  if (!left || !right || isOtcOnlyLabel(left) || isOtcOnlyLabel(right)) return null;
  if (left.includes(':') || right.includes(':')) return null;
  const formatted = formatPairLabel(`${left}/${right}`);
  return formatted || `${displayLeg(left)}/${displayLeg(right)}`;
}

function formatWireDisplayName(value, active) {
  const pair = formatPairLabel(value);
  if (pair) return applyOtcSuffix(pair, active, value);
  const raw = cleanLabel(value);
  if (!raw || isOtcOnlyLabel(raw)) return null;
  const body = stripInstrumentSuffixes(raw);
  if (!body || isOtcOnlyLabel(body)) return null;
  return applyOtcSuffix(body, active, raw);
}

/**
 * Name shown on the IQ Option client.
 * Pairs: "EUR / USD" or "EUR / USD (OTC)". Indices: traderoom short names
 * ("JP 225"), never "Japan 225 Spot Index" and never backend tickers ("NKY").
 * ETFs: client casing ("iShares Russell 2000 ETF").
 */
function displayNameForActive(active, fallback = null) {
  if (active && typeof active === 'object') {
    const fromSides = pairFromSides(active);
    if (fromSides) return applyOtcSuffix(fromSides, active);

    for (const field of [active.name, active.description, active.display_name, active.ticker]) {
      const pair = formatPairLabel(field);
      if (pair) return applyOtcSuffix(pair, active, field);
    }

    for (const field of [active.description, active.display_name]) {
      const cleaned = cleanLabel(field);
      if (!cleaned || isOtcOnlyLabel(cleaned)) continue;
      const stripped = cleaned.replace(/\s+(TURBO|BINARY|BLITZ|DIGITAL)$/i, '').trim();
      if (isSpotIndexLabel(stripped)) continue;
      const core = stripOtcMarker(stripped);
      const label = isAllCapsPhrase(core) ? titleCaseClientLabel(core) : core;
      return applyOtcSuffix(label, active, field);
    }

    const indexName = formatIndexDisplayName(active.name, active);
    if (indexName) return indexName;

    for (const field of [active.name, active.ticker, active.underlying, active.image]) {
      const formatted = formatWireDisplayName(field, active);
      if (formatted) return formatted;
    }
  }
  if (fallback != null && String(fallback)) {
    const pair = formatPairLabel(fallback);
    if (pair) return applyOtcSuffix(pair, active, fallback);
    return formatIndexDisplayName(fallback, active)
      || formatWireDisplayName(fallback, active)
      || String(fallback);
  }
  const id = active?.id ?? active?.active_id;
  return id != null ? `active-${id}` : '';
}

/**
 * Human-friendly fields derived from a get-active / init-data active object.
 * Prefer get-active: it already returns clean `name` / `description`.
 */
function formatActive(active) {
  if (!active || typeof active !== 'object') return null;
  const id = active.id ?? active.active_id ?? null;
  const name = cleanLabel(active.name) || cleanLabel(active.ticker) || (id != null ? `active-${id}` : null);
  const description = displayNameForActive(active, name);
  // Compact wire symbol: "EURUSD-OTC" / "EUR/USD (OTC)" → "EURUSD"
  const symbol =
    pairFromSides(active)?.replace(/\//g, '').replace(/\s+/g, '') ||
    stripOtcMarker(name || '')
      .replace(/\//g, '')
      .replace(/\s+/g, '') ||
    name;

  return {
    id,
    name,
    description,
    symbol,
    group: cleanLabel(active.group_name) || cleanLabel(active.active_type) || null,
    isOtc: Boolean(active.is_otc) || hasOtcMarker(active, name) || hasOtcMarker(active, description),
    precision: active.precision ?? 6,
    label: id != null ? `${description || symbol || name}#${id}` : description || symbol || name,
  };
}

/**
 * Convert a live quote (e.g. 1.14385) into the integer `value` open-option expects.
 * Capture shows value = round(quote * 10^precision); precision comes from get-active.
 */
function toWireValue(quote, precision = 6) {
  const q = Number(quote);
  if (!Number.isFinite(q)) throw new Error(`toWireValue: invalid quote ${quote}`);
  return Math.round(q * 10 ** precision);
}

module.exports = (socket) => ({
  /**
   * Single instrument metadata. Best source for display names:
   *   { id: 76, name: "EURUSD-OTC", description: "EUR/USD (OTC)", ... }
   */
  getActive({ id }) {
    if (id == null) throw new Error('getActive requires id');
    return socket.call(METHOD.GET_ACTIVE, { id }, { version: '5.0' });
  },

  /**
   * Grouped lists of active ids (forex, crypto, commodity, ...). Ids only —
   * resolve each with getActive() when you need names.
   */
  getActivesIndex({ lang = 'en_US' } = {}) {
    return socket.call(METHOD.GET_ACTIVES_INDEX, { lang }, { version: '2.0' });
  },

  /**
   * Turbo / binary / blitz init bundle: per-active expiration schedule,
   * min/max bet, commission, precision. Reply shape:
   *   { turbo: { actives: { "76": {...} } }, binary: {...}, blitz: {...}, ... }
   */
  getInitializationData(opts = {}) {
    return socket.call(METHOD.GET_INITIALIZATION_DATA, {}, { version: '4.0', timeoutMs: opts.timeoutMs ?? 20_000, ...opts });
  },

  /** Same payload family as getInitializationData, binary-options namespace. */
  getBinaryInitializationData() {
    return socket.call(METHOD.GET_BINARY_INITIALIZATION_DATA, {}, { version: '4.0' });
  },

  /**
   * Ranked assets for a product line (used by the traderoom "top" strip).
   * @param {{instrumentType:string, regionId?:number}} p
   */
  getTopAssets({ instrumentType, regionId = -1 }) {
    if (!instrumentType) throw new Error('getTopAssets requires instrumentType');
    return socket.call(
      METHOD.GET_TOP_ASSETS,
      { instrument_type: instrumentType, region_id: regionId },
      { version: '3.0' }
    );
  },

  /**
   * Per-active commission table for an instrument type (turbo/binary/blitz/digital).
   * profit_percent for open-option ≈ 100 - commission.
   */
  getTradingGroupParams({ instrumentType }) {
    if (!instrumentType) throw new Error('getTradingGroupParams requires instrumentType');
    return socket.call(
      METHOD.GET_TRADING_GROUP_PARAMS,
      { instrument_type: instrumentType },
      { version: '2.0' }
    );
  },

  /**
   * Convenience: getActive + formatActive in one call.
   * @returns {Promise<{raw: object, id:number, name:string, symbol:string, description:string, label:string, precision:number}>}
   */
  async resolveActive(id) {
    try {
      const raw = await this.getActive({ id });
      const formatted = formatActive(raw) || { id, name: `active-${id}`, symbol: `active-${id}`, label: `#${id}` };
      return { raw, ...formatted };
    } catch (err) {
      const isOtc = id === 76;
      const defaultName = id === 76 ? 'EURUSD-OTC' : (id === 1 ? 'EURUSD' : `active-${id}`);
      const defaultDesc = id === 76 ? 'EUR/USD (OTC)' : (id === 1 ? 'EUR/USD' : `Active #${id}`);
      return {
        raw: { id, name: defaultName, description: defaultDesc },
        id,
        name: defaultName,
        description: defaultDesc,
        symbol: defaultName,
        group: 'forex',
        isOtc,
        precision: 5,
        label: `${defaultDesc}#${id}`,
      };
    }
  },

  // Pure helpers re-exported on the client so callers don't import the module.
  formatActive,
  displayNameForActive,
  cleanLabel,
  toWireValue,
});

module.exports.formatActive = formatActive;
module.exports.displayNameForActive = displayNameForActive;
module.exports.cleanLabel = cleanLabel;
module.exports.toWireValue = toWireValue;
