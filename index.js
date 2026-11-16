/**
 * IQBroker Library
 *
 * Standalone, framework-agnostic client for IQ Option (Quadcode protocol).
 *
 * Capabilities:
 *   - Headless HTTP login and session management
 *   - Browser-assisted session capture via Playwright & CDP
 *   - Persistent WebSocket connection with request-correlation and heartbeats
 *   - Candle retrieval (historical & real-time streaming)
 *   - Balance management (real, practice, tournament, account switching)
 *   - Instrument metadata and asset schedule resolution
 *   - Hardened trade execution (Turbo, Binary, Blitz, Digital) with duration and response guards
 *   - Pluggable order placers and in-memory trade lifecycle management
 *
 * This package is completely decoupled from proprietary strategy engines,
 * pattern scanners, and ML models.
 */

const { BrokerClient, IQClient, AuthenticationError, isAuthenticationError } = require('./src/client/BrokerClient');
const { createClient, createSsidRefresher } = require('./src/auth/session');
const { loginWithPassword, DEFAULT_LOGIN_URL, DEFAULT_TIMEOUT_MS } = require('./src/auth/httpLogin');
const { captureBrowserSession, writeSsidToEnvFile } = require('./src/auth/browserSession');
const { ConnectionLayer } = require('./src/connection/connectionLayer');
const { IQSocket } = require('./src/core/socket');
const { createLogger } = require('./src/core/logger');
const constants = require('./src/protocol/constants');
const timing = require('./src/client/timing');
const indicators = require('./src/client/indicators');
const assetFilter = require('./src/client/assetFilter');
const candleMethods = require('./src/client/methods/candles');
const trade = require('./src/trade');

module.exports = {
  // Client & Connection
  BrokerClient,
  IQClient,
  createClient,
  createSsidRefresher,
  ConnectionLayer,
  IQSocket,
  createLogger,
  AuthenticationError,
  isAuthenticationError,

  // Authentication (Headless HTTP + Browser Session Capture)
  loginWithPassword,
  captureBrowserSession,
  writeSsidToEnvFile,
  DEFAULT_LOGIN_URL,
  DEFAULT_TIMEOUT_MS,

  // Protocol & Constants
  constants,

  // Timing & Indicators
  timing,
  indicators,

  // Candle Helpers & Normalization
  normalizeCandle: candleMethods.normalizeCandle,
  normalizeCandles: candleMethods.normalizeCandles,
  extractCandles: candleMethods.extractCandles,

  // Asset Filter & Schedules
  assetFilter,

  // Trade Execution, Guards, & Lifecycle Ledger
  trade,
  TradeReconciler: trade.TradeReconciler,
  OrderIdGenerator: trade.OrderIdGenerator,
};
