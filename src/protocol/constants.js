/**
 * Wire-protocol constants for IQ Option (Quadcode protocol).
 * Plain frozen objects with zero external dependencies.
 */

const BALANCE_TYPE = Object.freeze({
  REAL: 1,
  TOURNAMENT: 2,
  PRACTICE: 4,
});

const OPTION_TYPE_ID = Object.freeze({
  BINARY: 1, // classic, longer fixed expiry
  TURBO: 3, // short (~1-5 min) fixed expiry
  BLITZ: 12, // seconds-based, requires expiration_size
});

const INSTRUMENT_TYPE = Object.freeze({
  BINARY: 'binary-option',
  TURBO: 'turbo-option',
  BLITZ: 'blitz-option',
  DIGITAL: 'digital-option',
  FX: 'fx-option',
  EXCHANGE: 'exchange-option',
  MARGINAL_FOREX: 'marginal-forex',
  MARGINAL_CFD: 'marginal-cfd',
  MARGINAL_CRYPTO: 'marginal-crypto',
});

const DIRECTION = Object.freeze({
  CALL: 'call',
  PUT: 'put',
});

// sendMessage inner `name` values (method identifiers)
const METHOD = Object.freeze({
  AUTHENTICATE: 'authenticate',
  GET_PROFILE: 'core.get-profile',
  GET_BALANCES: 'internal-billing.get-balances',
  GET_USER_SETTINGS: 'get-user-settings',
  SET_USER_SETTINGS: 'set-user-settings',
  GET_CANDLES: 'get-candles',
  GET_FIRST_CANDLES: 'get-first-candles',
  GET_POSITIONS: 'portfolio.get-positions',
  GET_ORDERS: 'portfolio.get-orders',
  SUBSCRIBE_POSITIONS: 'subscribe-positions',
  OPEN_OPTION: 'binary-options.open-option',
  ROLLOVER_OPTION: 'rollover-option',
  SELL_OPTIONS: 'sell-options',
  PLACE_DIGITAL_OPTION: 'digital-options.place-digital-option',
  GET_DIGITAL_INSTRUMENTS: 'digital-option-instruments.get-instruments',
  GET_DIGITAL_UNDERLYINGS: 'digital-option-instruments.get-underlying-list',
  GET_TOP_ASSETS: 'get-top-assets',
  GET_ACTIVE: 'get-active',
  GET_ACTIVES_INDEX: 'get-actives-index',
  GET_INITIALIZATION_DATA: 'get-initialization-data',
  GET_BINARY_INITIALIZATION_DATA: 'binary-options.get-initialization-data',
  GET_TRADING_GROUP_PARAMS: 'trading-settings.get-trading-group-params',
  GET_SCRIPT_INDICATORS: 'tech-instruments.get-script-indicators',
});

// subscribeMessage stream names (what you put in subscribeMessage.msg.name).
const STREAM = Object.freeze({
  CANDLE_GENERATED: 'candle-generated',
  CANDLES_GENERATED: 'candles-generated',
  POSITIONS_STATE: 'positions-state',
  POSITION_CHANGED: 'portfolio.position-changed',
  POSITION_CHANGED_PUSH: 'position-changed',
  ORDER_CHANGED: 'portfolio.order-changed',
  ORDER_CHANGED_PUSH: 'order-changed',
  BALANCE_CHANGED: 'balances.balance-changed',
  INTERNAL_BILLING_BALANCE_CHANGED: 'internal-billing.balance-changed',
  DIGITAL_CLIENT_PRICE_SUBSCRIBE: 'trading-settings.digital-option-client-price-generated',
  DIGITAL_CLIENT_PRICE: 'digital-option-client-price-generated',
  STANDARD_LIBRARY_CHANGED: 'tech-instruments.standard-library-changed',
  PROFILE_CHANGED: 'core.profile-changed',
});

module.exports = {
  BALANCE_TYPE,
  OPTION_TYPE_ID,
  INSTRUMENT_TYPE,
  DIRECTION,
  METHOD,
  STREAM,
};
