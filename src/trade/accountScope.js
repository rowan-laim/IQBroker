/**
 * Account scope for trade books.
 * The definitions live in balanceBook so the browser and the server share one copy.
 */

const {
  normalizeTradeAccount,
  normalizeStatsScope,
  tradeMatchesScope,
} = require('./balanceBook');

module.exports = {
  normalizeTradeAccount,
  normalizeStatsScope,
  tradeMatchesScope,
};
