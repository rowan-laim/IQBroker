const { EventEmitter } = require('node:events');
const { awaitingServerId } = require('./tradeRecovery');
const { collectPositionIds, outcomeFromPosition, profitFromPosition, isClosedPosition } = require('./settlement');
const { analyzeTradePerformance } = require('./metrics');
const { normalizeStatsScope, tradeMatchesScope } = require('./accountScope');
const { resolveStakeFromBalance, DEFAULT_STAKE_TIERS } = require('./stakeSizing');
const {
  candleOpenTimeMs,
  candleCloseTimeMs,
  isExpirySettlementBar,
  resolveLiveExpirySettlement,
  applyLiveBalanceSample,
} = require('./liveSettlement');

/**
 * TradeManager — ownership of trade lifecycle only (open/settle/index).
 * Ported & adapted from OpenBot (openbot/trades/engine.py & openbot/stats/types.py).
 *
 * Settlement-field mapping lives in ./settlement.js and stats/summary math
 * lives in ./metrics.js — this class is now just the ledger: it records
 * placements, indexes them by every id the server might use to refer back
 * to them, and settles them when a result arrives.
 *
 * Placement ids may be option ids (turbo/binary/blitz) or temporary order ids
 * (digital). Position-changed / order-changed can re-key a trade via
 * attachExternalIds() once the server position id is known.
 *
 * IMPORTANT: recordPlacement() must only ever be called for a placement the
 * caller has already confirmed (see ./executionGuard.js + ./tradeEngine.js).
 * This class intentionally does not talk to the broker and does not decide
 * whether a placement succeeded — that decision must be made before this
 * is called, or a rejected/ambiguous order gets counted as a real trade.
 */
class TradeManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.stake = opts.stake ?? 10;
    this.balanceBook = opts.balanceBook || require('./balanceBook');
    const startBal = Number(opts.startingBalance);
    this.startingBalance = Number.isFinite(startBal) ? startBal : null;
    this.openTrades = new Map(); // tradeId -> tradeRecord
    this.closedTrades = []; // array of settled tradeRecords
    // Secondary indexes so position-changed / order-changed can find trades
    // even when the place reply id differs from the position id (digital).
    this.byOrderId = new Map();
    this.byPositionId = new Map();
    this.byExternalId = new Map();

    // Performance metrics
    this.totalTrades = 0;
    this.wins = 0;
    this.losses = 0;
    this.ties = 0;
    this.grossProfit = 0;
    this.grossLoss = 0;
    this.netPnL = 0;
    this.peakEquity = 0;
    this.maxDrawdown = 0;
    this.currentConsecutiveWins = 0;
    this.currentConsecutiveLosses = 0;
    this.maxConsecutiveWins = 0;
    this.maxConsecutiveLosses = 0;
  }

  _index(record) {
    if (record.orderId != null) this.byOrderId.set(String(record.orderId), record.id);
    if (record.positionId != null) this.byPositionId.set(String(record.positionId), record.id);
    if (record.externalId != null) this.byExternalId.set(String(record.externalId), record.id);
  }

  _unindex(record) {
    if (record.orderId != null) this.byOrderId.delete(String(record.orderId));
    if (record.positionId != null) this.byPositionId.delete(String(record.positionId));
    if (record.externalId != null) this.byExternalId.delete(String(record.externalId));
  }

  /**
   * Record a new open trade placement.
   *
   * Guardrails against the "counted a rejected trade" bug:
   * - `expiryTime` must resolve to a finite timestamp strictly after `now`.
   *   There is deliberately NO fallback to `Date.now() + timeframe` here —
   *   a caller with no valid expiry must fix that upstream (see
   *   durationGuard.assertValidExpiry), not have this silently invent one.
   * - A placement with no orderId/positionId/externalId AND not explicitly
   *   flagged `unconfirmed: true` is rejected outright — an id-less trade
   *   must say so, it can't just be assumed OPEN.
   */
  recordPlacement(trade) {
    const now = Date.now();
    const expiryTime = Number(trade.expiryTime);
    if (!Number.isFinite(expiryTime) || expiryTime <= now) {
      throw new Error(
        `recordPlacement: refusing to record a trade with an invalid/expired expiryTime `
        + `(expiryTime=${trade.expiryTime}, now=${now}). Validate duration before calling recordPlacement.`
      );
    }

    const hasAnyServerId = trade.orderId != null || trade.positionId != null || trade.externalId != null;
    const unconfirmed = trade.unconfirmed === true;
    if (!hasAnyServerId && !unconfirmed) {
      throw new Error(
        'recordPlacement: trade has no orderId/positionId/externalId and is not marked unconfirmed. '
        + 'A placement with no server id must be explicit about being unconfirmed so it is never '
        + 'silently counted as a confirmed open trade.'
      );
    }

    const id = trade.id != null ? String(trade.id) : `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record = {
      id,
      orderId: trade.orderId != null ? trade.orderId : null,
      positionId: trade.positionId != null ? trade.positionId : null,
      externalId: trade.externalId != null ? trade.externalId : (trade.id != null ? trade.id : null),
      activeId: trade.activeId,
      symbol: trade.symbol,
      product: trade.product || 'turbo',
      direction: trade.direction, // 'call' | 'put'
      stake: Number(trade.stake || this.stake),
      stakeTier: trade.stakeTier || null,
      balanceBefore: Number.isFinite(Number(trade.balanceBefore)) ? Number(trade.balanceBefore) : null,
      balanceAfterPlace: Number.isFinite(Number(trade.balanceAfterPlace)) ? Number(trade.balanceAfterPlace) : null,
      liveBalance: Number.isFinite(Number(trade.liveBalance ?? trade.balanceAfterPlace))
        ? Number(trade.liveBalance ?? trade.balanceAfterPlace)
        : null,
      balanceAfterPlaceFrozen: false,
      balanceAfterPlaceSnapshot: trade.balanceAfterPlaceSnapshot || null,
      balanceAfterSettlement: trade.balanceAfterSettlement || null,
      balanceSnapshots: Array.isArray(trade.balanceSnapshots) ? trade.balanceSnapshots.slice(-20) : [],
      entryPrice: Number(trade.entryPrice),
      entryTime: trade.entryTime || now,
      expiryTime,
      payoutPercent: Number(trade.payoutPercent || 80),
      levelType: trade.levelType || 'support_resistance',
      signalType: trade.signalType || null,
      signalId: trade.signalId || trade.signal?.id || null,
      patternId: trade.patternId || trade.signal?.patternId || trade.strategy || null,
      variant: trade.variant || trade.signal?.metadata?.variant || null,
      levelPrice: trade.levelPrice || null,
      confidence: trade.confidence || 0.8,
      account: trade.account || 'practice',
      instrumentId: trade.instrumentId || null,
      expirationSize: trade.expirationSize ?? null,
      durationSec: trade.durationSec ?? (Number.isFinite(Number(trade.expirationSize)) && Number(trade.expirationSize) > 0 ? Number(trade.expirationSize) : (Number.isFinite(expiryTime) && expiryTime > (trade.entryTime || now) ? Math.round((expiryTime - (trade.entryTime || now)) / 1000) : 300)),
      snapshotId: trade.snapshotId || trade.candidateId || trade.signal?.candidateId || null,
      status: 'OPEN',
      unconfirmed,
      recovered: trade.recovered === true,
      placedAt: now,
      rawPlaceReply: trade.rawPlaceReply || null,
    };

    this.openTrades.set(record.id, record);
    this._index(record);
    this.emit('tradePlaced', record);
    return record;
  }

  /**
   * Attach server ids discovered after place (digital order → position).
   */
  attachExternalIds(tradeId, { orderId, positionId, externalId } = {}) {
    const trade = this.openTrades.get(String(tradeId)) || this.findOpenTrade(tradeId);
    if (!trade) return null;
    this._unindex(trade);
    if (orderId != null) trade.orderId = orderId;
    if (positionId != null) trade.positionId = positionId;
    if (externalId != null) trade.externalId = externalId;
    if (trade.orderId != null || trade.positionId != null) trade.unconfirmed = false;
    this._index(trade);
    return trade;
  }

  /**
   * Match a server position/order to a local trade that never got a place id.
   */
  findUnconfirmedMatch(found) {
    if (!found || found.activeId == null) return null;
    for (const trade of this.openTrades.values()) {
      if (!awaitingServerId(trade)) continue;
      if (Number(trade.activeId) !== Number(found.activeId)) continue;
      if (trade.direction && found.direction && trade.direction !== found.direction) continue;
      if (trade.product && found.product && trade.product !== found.product) continue;
      if (Number.isFinite(Number(trade.stake)) && Number.isFinite(found.stake)
        && Math.abs(Number(trade.stake) - found.stake) > 0.05) {
        continue;
      }
      return trade;
    }
    return null;
  }

  /**
   * Find an open trade by any known server id (trade id, order, position, external).
   */
  findOpenTrade(anyId) {
    if (anyId == null) return null;
    const key = String(anyId);
    if (this.openTrades.has(key)) return this.openTrades.get(key);
    const mapped =
      this.byOrderId.get(key) ||
      this.byPositionId.get(key) ||
      this.byExternalId.get(key);
    if (mapped && this.openTrades.has(mapped)) return this.openTrades.get(mapped);
    for (const trade of this.openTrades.values()) {
      if (
        String(trade.id) === key ||
        String(trade.orderId) === key ||
        String(trade.positionId) === key ||
        String(trade.externalId) === key
      ) {
        return trade;
      }
    }
    return null;
  }

  /**
   * Settle an open trade given exit price or explicit outcome.
   */
  settleTrade(tradeId, { exitPrice, exitTime = Date.now(), forcedOutcome = null, profit = null, closeReason = null, source = 'local', raw = null } = {}) {
    const trade = this.openTrades.get(String(tradeId)) || this.findOpenTrade(tradeId);
    if (!trade) return null;
    const id = trade.id;

    if (exitPrice != null && Number.isFinite(Number(exitPrice))) {
      trade.exitPrice = Number(exitPrice);
    }
    trade.exitTime = exitTime;
    trade.closeReason = closeReason;
    trade.settlementSource = source;
    if (raw) trade.settlementRaw = raw;

    let outcome = forcedOutcome;
    if (!outcome && Number.isFinite(trade.exitPrice) && Number.isFinite(trade.entryPrice)) {
      if (trade.direction === 'call') {
        if (trade.exitPrice > trade.entryPrice) outcome = 'WIN';
        else if (trade.exitPrice < trade.entryPrice) outcome = 'LOSS';
        else outcome = 'TIE';
      } else if (trade.direction === 'put') {
        if (trade.exitPrice < trade.entryPrice) outcome = 'WIN';
        else if (trade.exitPrice > trade.entryPrice) outcome = 'LOSS';
        else outcome = 'TIE';
      }
    }

    if (!outcome) outcome = 'TIE';

    trade.outcome = outcome;
    trade.status = 'SETTLED';

    const payoutRatio = trade.payoutPercent / 100;
    if (profit != null && Number.isFinite(Number(profit))) {
      // Server-authoritative PnL (pnl_net / close_profit - stake).
      trade.profit = Number(Number(profit).toFixed(2));
    } else if (outcome === 'WIN') {
      trade.profit = Number((trade.stake * payoutRatio).toFixed(2));
    } else if (outcome === 'LOSS') {
      trade.profit = -trade.stake;
    } else {
      trade.profit = 0;
    }

    this._applyOutcomeToTotals(trade);
    this._unindex(trade);
    this.openTrades.delete(id);
    this.closedTrades.push(trade);

    const summary = this.getSummary();
    this.emit('tradeSettled', { trade, summary });
    return trade;
  }

  /**
   * Apply a portfolio.position-changed / position-changed push to an open trade.
   * Returns the settled trade, an updated open trade, or null.
   */
  applyPositionChanged(msg) {
    if (!msg || typeof msg !== 'object') return null;

    const raw = msg.raw_event ? Object.values(msg.raw_event)[0] : null;
    const ids = collectPositionIds(msg, raw);
    let trade = null;
    for (const id of ids) {
      trade = this.findOpenTrade(id);
      if (trade) break;
    }
    if (!trade) return null;

    // Keep ids fresh (digital: order id on place, position id later).
    this.attachExternalIds(trade.id, {
      orderId: raw?.order_ids?.[0] ?? trade.orderId,
      positionId: raw?.id ?? msg.external_id ?? trade.positionId,
      externalId: msg.external_id ?? raw?.option_id ?? raw?.id ?? trade.externalId,
    });

    if (!isClosedPosition(msg, raw)) {
      // Still open — optionally refresh live quote on the record.
      if (msg.current_price != null) trade.currentPrice = Number(msg.current_price);
      if (msg.pnl_net != null) trade.unrealizedPnl = Number(msg.pnl_net);
      return trade;
    }

    const outcome = outcomeFromPosition(msg, raw, trade);
    const exitPrice =
      msg.close_quote ??
      raw?.close_underlying_price ??
      raw?.expiration_value ??
      msg.current_price ??
      trade.entryPrice;
    const profit = profitFromPosition(msg, raw, trade);
    const closeReason = msg.close_reason || raw?.close_reason || raw?.result || null;
    const exitTime = msg.close_time || raw?.close_at || raw?.actual_expire * 1000 || Date.now();

    return this.settleTrade(trade.id, {
      exitPrice,
      exitTime: Number(exitTime) || Date.now(),
      forcedOutcome: outcome,
      profit,
      closeReason,
      source: 'position-changed',
      raw: msg,
    });
  }

  cacheBalanceAfterPlace(tradeId, amount, { now = Date.now() } = {}) {
    const trade = this.openTrades.get(String(tradeId)) || this.findOpenTrade(tradeId);
    if (!trade || trade.isPaper) return null;
    applyLiveBalanceSample(trade, amount, { now });
    return trade;
  }

  recordBalanceSample(amount, { now = Date.now(), account = null } = {}) {
    const settled = [];
    for (const trade of this.openTrades.values()) {
      if (trade.isPaper || (account && trade.account && String(trade.account).toLowerCase() !== String(account).toLowerCase())) continue;
      applyLiveBalanceSample(trade, amount, { now });
    }
    for (const trade of [...this.openTrades.values()]) {
      if (trade.isPaper || trade.unconfirmed || !Number.isFinite(Number(trade.expiryQuote))) continue;
      const decided = resolveLiveExpirySettlement(trade, { now });
      if (!decided.outcome) continue;
      const result = this.settleTrade(trade.id, { exitPrice: decided.exitPrice,
        exitTime: Number(trade.expiryBarCloseMs) || now, forcedOutcome: decided.outcome,
        profit: decided.profit, closeReason: decided.reason, source: `live-evidence:${decided.reason}` });
      if (result) settled.push(result);
    }
    return settled;
  }

  observeLiveBalance(amount, { now = Date.now(), account = null } = {}) {
    const settled = [];
    const n = Number(amount);
    if (!Number.isFinite(n)) return settled;
    for (const trade of this.openTrades.values()) {
      if (trade.isPaper) continue;
      if (account && trade.account && String(trade.account).toLowerCase() !== String(account).toLowerCase()) continue;
      applyLiveBalanceSample(trade, n, { now });
    }
    for (const trade of [...this.openTrades.values()]) {
      if (trade.isPaper || trade.unconfirmed) continue;
      if (account && trade.account && String(trade.account).toLowerCase() !== String(account).toLowerCase()) continue;
      if (!Number.isFinite(Number(trade.expiryQuote))) continue;
      const decided = resolveLiveExpirySettlement(trade, { now });
      if (!decided.outcome) continue;
      const res = this.settleTrade(trade.id, {
        exitPrice: decided.exitPrice,
        exitTime: Number(trade.expiryBarCloseMs) || now,
        forcedOutcome: decided.outcome,
        profit: decided.profit,
        closeReason: decided.reason,
        source: `live-evidence:${decided.reason}`,
      });
      if (res) settled.push(res);
    }
    return settled;
  }

  /**
   * Checks open trades for expiry and settles any that have expired.
   * Live trades need the expiry bar plus the frozen post-place balance.
   */
  checkExpiries(closedCandle, { now = Date.now() } = {}) {
    if (!closedCandle) return [];
    const settled = [];
    const candleOpenMs = candleOpenTimeMs(closedCandle);
    const candleCloseMs = candleCloseTimeMs(closedCandle);
    const closePrice = Number(closedCandle.close ?? closedCandle.c);

    for (const [id, trade] of [...this.openTrades.entries()]) {
      if (Number(trade.activeId) !== Number(closedCandle.activeId)) continue;
      if (trade.unconfirmed) continue;
      const expiry = Number(trade.expiryTime) || 0;
      const expiryBar = isExpirySettlementBar(candleOpenMs, candleCloseMs, expiry);
      if (expiryBar && Number.isFinite(closePrice)) {
        trade.expiryQuote = closePrice;
        trade.expiryBarCloseMs = candleCloseMs;
        trade.expiryCandle = {
          activeId: Number(closedCandle.activeId), from: candleOpenMs, to: candleCloseMs,
          open: Number(closedCandle.open ?? closedCandle.o), high: Number(closedCandle.high ?? closedCandle.h),
          low: Number(closedCandle.low ?? closedCandle.l), close: closePrice,
          directionOutcome: require('./liveSettlement').candleDirectionOutcome(trade.direction, trade.entryPrice, closePrice),
        };
      }
      const exitPrice = Number(trade.expiryQuote);
      if (!Number.isFinite(exitPrice)) continue;
      const decided = resolveLiveExpirySettlement(trade, { now });
      if (!decided.outcome) continue;
      const res = this.settleTrade(id, {
        exitPrice: decided.exitPrice,
        exitTime: Number(trade.expiryBarCloseMs) || candleCloseMs,
        forcedOutcome: decided.outcome,
        profit: decided.profit,
        closeReason: decided.reason,
        source: `live-evidence:${decided.reason}`,
      });
      if (res) settled.push(res);
    }
    return settled;
  }

  /**
   * Drop unconfirmed local rows that never gained a server id past expiry.
   * Does not count toward wins/losses — the place may never have landed.
   */
  abandonExpiredUnconfirmed(now = Date.now()) {
    const dropped = [];
    for (const [id, trade] of this.openTrades.entries()) {
      if (!trade.unconfirmed) continue;
      const expiry = Number(trade.expiryTime) || 0;
      if (now < expiry + 5_000) continue;
      this._unindex(trade);
      this.openTrades.delete(id);
      trade.status = 'ABANDONED';
      dropped.push(trade);
    }
    return dropped;
  }

  _applyOutcomeToTotals(trade) {
    const outcome = trade.outcome;
    const profit = Number(trade.profit) || 0;
    if (outcome === 'WIN') {
      this.wins++;
      this.grossProfit += Math.max(0, profit);
      this.currentConsecutiveWins++;
      this.currentConsecutiveLosses = 0;
      if (this.currentConsecutiveWins > this.maxConsecutiveWins) {
        this.maxConsecutiveWins = this.currentConsecutiveWins;
      }
    } else if (outcome === 'LOSS') {
      this.losses++;
      this.grossLoss += Math.abs(profit);
      this.currentConsecutiveLosses++;
      this.currentConsecutiveWins = 0;
      if (this.currentConsecutiveLosses > this.maxConsecutiveLosses) {
        this.maxConsecutiveLosses = this.currentConsecutiveLosses;
      }
    } else {
      this.ties++;
    }

    this.totalTrades++;
    this.netPnL = Number((this.grossProfit - this.grossLoss).toFixed(2));
    if (this.netPnL > this.peakEquity) this.peakEquity = this.netPnL;
    const dd = this.peakEquity - this.netPnL;
    if (dd > this.maxDrawdown) this.maxDrawdown = Number(dd.toFixed(2));
  }

  /**
   * Replay settled history from SQLite without emitting events.
   * Must be chronological so streak / drawdown match a live session.
   */
  hydrateSettled(trades = []) {
    const settled = trades.filter((t) => t && t.outcome);
    settled.sort((a, b) => (
      Number(a.exitTime || a.entryTime || 0) - Number(b.exitTime || b.entryTime || 0)
    ));
    for (const trade of settled) {
      const record = { ...trade, status: 'SETTLED' };
      this._applyOutcomeToTotals(record);
      this.closedTrades.push(record);
    }
    return this.getSummary();
  }

  /** Restore outstanding placements from the durable ledger after restart. */
  hydrateOpen(trades = []) {
    for (const trade of trades) {
      if (!trade || trade.id == null || this.findOpenTrade(trade.id)) continue;
      const record = { ...trade, id: String(trade.id), status: 'OPEN' };
      this.openTrades.set(record.id, record);
      this._index(record);
    }
    return this.openTrades.size;
  }

  _book(account) {
    const scope = account == null || account === '' ? 'combined' : normalizeStatsScope(account);
    if (scope === 'combined') {
      return { scope, closed: this.closedTrades, openCount: this.openTrades.size };
    }
    const closed = this.closedTrades.filter((trade) => tradeMatchesScope(trade, scope));
    let openCount = 0;
    for (const trade of this.openTrades.values()) {
      if (tradeMatchesScope(trade, scope)) openCount += 1;
    }
    return { scope, closed, openCount };
  }

  _openTradesFor(scope) {
    const open = [...this.openTrades.values()];
    if (!scope || scope === 'combined') return open;
    return open.filter((trade) => tradeMatchesScope(trade, scope));
  }

  getSessionSummary(startedAt, { account, observedBalance } = {}) {
    const book = this._book(account);
    if (startedAt == null) return this.getSummary({ account: book.scope, observedBalance });
    const since = Number(startedAt);
    const session = book.closed.filter((t) => {
      const ts = Number(t.exitTime || t.placedAt || t.entryTime || 0);
      return Number.isFinite(ts) && ts >= since;
    });
    const openTrades = this._openTradesFor(book.scope);
    return this.balanceBook.summarizeTrades(session, {
      account: book.scope,
      openCount: openTrades.length,
      openTrades,
      startingBalance: this.startingBalance,
      observedBalance,
    });
  }

  lastActivityAt() {
    let max = null;
    const consider = (ts) => {
      const n = Number(ts);
      if (Number.isFinite(n) && n > 0 && (max == null || n > max)) max = n;
    };
    for (const trade of this.closedTrades) {
      consider(trade.exitTime || trade.placedAt || trade.entryTime);
    }
    for (const trade of this.openTrades.values()) {
      consider(trade.placedAt || trade.entryTime);
    }
    return max;
  }

  getWinRate() {
    return this.getSummary().winRate;
  }

  getProfitFactor() {
    return this.getSummary().profitFactor;
  }

  getSummary({ account, observedBalance, startingBalance } = {}) {
    const book = this._book(account);
    const openTrades = this._openTradesFor(book.scope);
    return this.balanceBook.summarizeTrades(book.closed, {
      account: book.scope,
      openCount: openTrades.length,
      openTrades,
      startingBalance: startingBalance !== undefined ? startingBalance : this.startingBalance,
      observedBalance,
    });
  }

  getPerformance(opts = {}) {
    const book = this._book(opts.account);
    const { settledTrades: persistedSettledTrades, openTrades: suppliedOpenTrades, ...performanceOptions } = opts;
    // When supplied, these are the canonical persisted ledger rows also used
    // by /api/trades. This keeps Learning counts aligned with the trade list
    // after restarts or broker settlement events missed by the in-memory book.
    const openTrades = Array.isArray(suppliedOpenTrades) ? suppliedOpenTrades : this._openTradesFor(book.scope);
    const settledTrades = Array.isArray(persistedSettledTrades) ? persistedSettledTrades : this.closedTrades;
    return analyzeTradePerformance(settledTrades, openTrades.length, {
      ...performanceOptions,
      openTrades,
      startingBalance: opts.startingBalance !== undefined ? opts.startingBalance : this.startingBalance,
      account: book.scope,
    });
  }
}

module.exports = TradeManager;
module.exports.resolveStakeFromBalance = resolveStakeFromBalance;
module.exports.DEFAULT_STAKE_TIERS = DEFAULT_STAKE_TIERS;
