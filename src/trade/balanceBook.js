/**
 * Balance book
 *
 * The only place that turns trades into money. Every layer reports net P&L
 * by summing the same per-trade profit, then reconciles that sum with the
 * account cash balance. Inject this module instead of recalculating.
 */

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function cents(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function fromCents(value) {
  return value / 100;
}

function normalizeTradeAccount(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'real' || raw === 'live') return 'real';
  if (raw === 'practice' || raw === 'paper' || raw === 'demo') return 'practice';
  return null;
}

function normalizeStatsScope(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === 'combined' || raw === 'all' || raw === 'both' || raw === 'learning') return 'combined';
  const account = normalizeTradeAccount(raw);
  if (!account) throw new Error('Stats scope must be practice, real, or combined');
  return account;
}

function tradeMatchesScope(trade, scope) {
  const normalized = normalizeStatsScope(scope);
  if (normalized === 'combined') return true;
  return normalizeTradeAccount(trade?.account) === normalized;
}

function timestampMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const ms = number < 1e11 ? number * 1000 : number;
  return Number.isFinite(new Date(ms).getTime()) ? ms : null;
}

/**
 * Signed net profit shown for one trade, in cents-rounded dollars.
 * Missing profit stays missing. It is never treated as zero.
 */
function tradeProfit(trade) {
  const primary = Number(trade?.profit);
  if (Number.isFinite(primary)) return roundMoney(primary);
  const fallback = Number(trade?.net_pnl);
  if (Number.isFinite(fallback)) return roundMoney(fallback);
  return null;
}

function emptyDirection() {
  return { count: 0, wins: 0, losses: 0, ties: 0, grossProfit: 0, grossLoss: 0, pnl: 0, winRate: 0 };
}

/**
 * @param {object[]} trades settled trades, already filtered to the rows being reported
 * @param {object} [options]
 * @param {number|null} [options.startingBalance]
 * @param {number|null} [options.observedBalance] broker cash for this account
 * @param {object[]} [options.openTrades]
 * @param {number} [options.openCount]
 * @param {'practice'|'real'|'combined'|null} [options.account]
 * @param {boolean} [options.includeCurve]
 */
function summarizeTrades(trades = [], options = {}) {
  const scope = options.account == null || options.account === '' ? null : normalizeStatsScope(options.account);
  const selected = (Array.isArray(trades) ? trades : []).filter((trade) => trade && (scope == null || tradeMatchesScope(trade, scope)));
  const openTrades = (Array.isArray(options.openTrades) ? options.openTrades : []).filter((trade) => trade && (scope == null || tradeMatchesScope(trade, scope)));
  const openCount = Number.isFinite(Number(options.openCount)) ? Number(options.openCount) : openTrades.length;
  const startCents = cents(options.startingBalance);
  const hasStart = startCents != null;
  const observedCents = cents(options.observedBalance);
  const hasObserved = observedCents != null;

  const chronological = [...selected].sort((a, b) =>
    (timestampMs(a?.exitTime ?? a?.entryTime ?? a?.placedAt) ?? 0)
      - (timestampMs(b?.exitTime ?? b?.entryTime ?? b?.placedAt) ?? 0)
  );

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let unpriced = 0;
  let profitCents = 0;
  let grossProfitCents = 0;
  let grossLossCents = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let stakeCents = 0;
  let totalR = 0;
  let maxDrawdownCents = 0;
  let curW = 0;
  let curL = 0;
  let maxW = 0;
  let maxL = 0;
  const calls = emptyDirection();
  const puts = emptyDirection();
  let equityCents = hasStart ? startCents : 0;
  let peakCents = hasStart ? startCents : null;

  const equityCurve = options.includeCurve === false ? null : [{
    time: chronological[0]?.entryTime || chronological[0]?.exitTime || null,
    pnl: 0,
    equity: hasStart ? fromCents(startCents) : 0,
  }];

  for (const trade of chronological) {
    const profit = tradeProfit(trade);
    const profitC = profit == null ? null : cents(profit);
    const stakeC = cents(trade.risk_amount ?? trade.stake) || 0;
    stakeCents += stakeC;
    const dir = String(trade.direction || '').toLowerCase();
    const bucket = dir === 'call' ? calls : puts;
    bucket.count += 1;

    if (trade.outcome === 'WIN') {
      wins += 1;
      bucket.wins += 1;
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (trade.outcome === 'LOSS') {
      losses += 1;
      bucket.losses += 1;
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else {
      ties += 1;
      bucket.ties += 1;
    }

    if (profitC == null) {
      unpriced += 1;
      continue;
    }
    profitCents += profitC;
    if (profitC > 0) {
      grossProfitCents += profitC;
      positiveCount += 1;
      bucket.grossProfit = fromCents(cents(bucket.grossProfit) + profitC);
    } else if (profitC < 0) {
      grossLossCents += -profitC;
      negativeCount += 1;
      bucket.grossLoss = fromCents(cents(bucket.grossLoss) + (-profitC));
    }
    if (stakeC > 0) totalR += profitC / stakeC;

    equityCents = (hasStart ? startCents : 0) + profitCents;
    if (peakCents == null || equityCents > peakCents) peakCents = equityCents;
    const drawdown = peakCents - equityCents;
    if (drawdown > maxDrawdownCents) maxDrawdownCents = drawdown;
    if (equityCurve) {
      equityCurve.push({
        time: trade.exitTime || trade.entryTime || trade.placedAt || null,
        pnl: fromCents(profitCents),
        equity: fromCents(equityCents),
        outcome: trade.outcome,
        symbol: trade.symbol,
        product: trade.product,
      });
    }
  }

  const netPnL = fromCents(profitCents);
  const grossProfit = fromCents(grossProfitCents);
  const grossLoss = fromCents(grossLossCents);
  const decisive = wins + losses;
  const avgWin = positiveCount > 0 ? roundMoney(grossProfit / positiveCount) : 0;
  const avgLoss = negativeCount > 0 ? roundMoney(grossLoss / negativeCount) : 0;
  const payoffRatio = avgLoss > 0 ? roundMoney(avgWin / avgLoss) : (avgWin > 0 ? 10 : 0);
  const winRateFrac = decisive > 0 ? wins / decisive : 0;
  const lossRateFrac = decisive > 0 ? losses / decisive : 0;
  const expectancy = roundMoney((winRateFrac * avgWin) - (lossRateFrac * avgLoss));
  const profitFactor = grossLossCents === 0 ? (grossProfitCents > 0 ? Infinity : 0) : roundMoney(grossProfit / grossLoss);
  const totalCapitalAtRisk = fromCents(stakeCents);
  const settledEquity = hasStart ? fromCents(startCents + profitCents) : null;
  const openStakeCents = openTrades.reduce((sum, trade) => sum + (cents(trade.stake ?? trade.risk_amount) || 0), 0);
  const openStake = fromCents(openStakeCents);
  const expectedCash = settledEquity == null ? null : roundMoney(settledEquity - openStake);
  const observedBalance = hasObserved ? fromCents(observedCents) : null;
  const reconciliationDelta = expectedCash == null || observedBalance == null ? null : roundMoney(observedBalance - expectedCash);
  const impliedStartingBalance = hasObserved ? roundMoney(fromCents(observedCents - profitCents + openStakeCents)) : null;

  const rate = (bucket) => {
    const bucketDecisive = bucket.wins + bucket.losses;
    bucket.winRate = bucketDecisive > 0 ? roundMoney((bucket.wins / bucketDecisive) * 100) : 0;
    bucket.pnl = roundMoney(bucket.grossProfit - bucket.grossLoss);
    bucket.grossProfit = roundMoney(bucket.grossProfit);
    bucket.grossLoss = roundMoney(bucket.grossLoss);
  };
  rate(calls);
  rate(puts);

  return {
    totalTrades: selected.length,
    pricedTrades: selected.length - unpriced,
    unpricedTrades: unpriced,
    openTrades: openCount,
    wins,
    losses,
    ties,
    winRate: decisive === 0 ? 0 : roundMoney((wins / decisive) * 100),
    netPnL,
    tradeProfitSum: netPnL,
    grossProfit,
    grossLoss,
    profitFactor,
    totalCapitalAtRisk,
    riskRoi: totalCapitalAtRisk > 0 ? roundMoney((netPnL / totalCapitalAtRisk) * 100) : 0,
    accountRoi: hasStart && startCents > 0 ? roundMoney(((settledEquity - fromCents(startCents)) / fromCents(startCents)) * 100) : null,
    expectancyR: selected.length > 0 ? Number((totalR / selected.length).toFixed(4)) : 0,
    avgWin,
    avgLoss,
    payoffRatio,
    expectancy,
    directional: { calls, puts },
    peakEquity: peakCents == null ? 0 : fromCents(peakCents),
    maxDrawdown: fromCents(maxDrawdownCents),
    balance: settledEquity,
    startingBalance: hasStart ? fromCents(startCents) : null,
    openStake,
    expectedCash,
    observedBalance,
    reconciliationDelta,
    reconciled: reconciliationDelta == null ? null : Math.abs(reconciliationDelta) < 0.05,
    impliedStartingBalance,
    ...(scope ? { accountScope: scope } : {}),
    currentConsecutiveWins: curW,
    currentConsecutiveLosses: curL,
    maxConsecutiveWins: maxW,
    maxConsecutiveLosses: maxL,
    recentTrades: chronological.slice(-10),
    ...(equityCurve ? { equityCurve } : {}),
  };
}

function accountBreakdown(trades = []) {
  const groups = { practice: [], real: [], unscoped: [] };
  for (const trade of trades) {
    if (!trade) continue;
    const book = normalizeTradeAccount(trade.account);
    if (book === 'practice' || book === 'real') groups[book].push(trade);
    else groups.unscoped.push(trade);
  }
  const slice = (list) => {
    const summary = summarizeTrades(list, { includeCurve: false });
    return {
      trades: summary.totalTrades,
      wins: summary.wins,
      losses: summary.losses,
      ties: summary.ties,
      winRate: summary.winRate,
      netPnL: summary.netPnL,
      tradeProfitSum: summary.tradeProfitSum,
      profitFactor: summary.profitFactor,
    };
  };
  const combined = slice(trades.filter(Boolean));
  return {
    practice: slice(groups.practice),
    real: slice(groups.real),
    unscoped: slice(groups.unscoped),
    combined,
  };
}

const api = {
  roundMoney,
  normalizeTradeAccount,
  normalizeStatsScope,
  tradeMatchesScope,
  timestampMs,
  tradeProfit,
  summarizeTrades,
  accountBreakdown,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.OpenIQBalance = api;
