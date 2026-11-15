/**
 * Metrics
 *
 * Pure win/loss/PnL summary over a list of settled trades. Extracted out
 * of TradeManager so performance-stat logic can be unit tested with
 * fixture trade arrays, independent of the ledger/indexing machinery.
 */

const { normalizeStatsScope, tradeMatchesScope } = require('./accountScope');
const balanceBook = require('./balanceBook');

function summarizeTradeList(trades, openCount = 0, options = {}) {
  return balanceBook.summarizeTrades(trades, {
    includeCurve: true,
    ...options,
    openCount: options.openCount ?? openCount,
  });
}

function formatDurationSec(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  return `${m}m ${remSec}s`;
}

function localDayBounds(nowMs = Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  let zone = timeZone;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(nowMs); }
  catch { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(formatter.formatToParts(nowMs).map((part) => [part.type, part.value]));
  const year = Number(parts.year); const month = Number(parts.month); const day = Number(parts.day);
  const midnight = (y, m, d) => {
    const target = Date.UTC(y, m - 1, d);
    let guess = target;
    const wallFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    for (let attempt = 0; attempt < 3; attempt++) {
      const wall = Object.fromEntries(wallFormatter.formatToParts(guess).map((part) => [part.type, part.value]));
      guess += target - Date.UTC(Number(wall.year), Number(wall.month) - 1, Number(wall.day), Number(wall.hour), Number(wall.minute), Number(wall.second));
    }
    return guess;
  };
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return { startMs: midnight(year, month, day), endMs: midnight(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate()) };
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
 * Reusable multi-dimensional trade analytics engine.
 * Computes KPIs, product breakdowns, asset breakdowns, periods, and equity curves.
 */
function analyzeTradePerformance(trades = [], openCount = 0, { startingBalance, observedBalance = null, openTrades = [], period = 'all', assetFilter = null, productFilter = null, account = null, timeZone, nowMs = Date.now() } = {}) {
  const now = Number(nowMs);
  const bounds = localDayBounds(now, timeZone);
  const scope = account == null || account === '' ? null : normalizeStatsScope(account);
  const inScope = (trade) => scope == null || tradeMatchesScope(trade, scope);

  const matchesDimensions = (trade) => {
    if (!trade) return false;
    if (assetFilter && String(trade.symbol || trade.activeId).toLowerCase() !== String(assetFilter).toLowerCase()) return false;
    if (productFilter && String(trade.product || '').toLowerCase() !== String(productFilter).toLowerCase()) return false;
    return true;
  };
  const inPeriod = (trade, selectedPeriod) => {
    const tradeTs = timestampMs(trade.entryTime ?? trade.placedAt);
    if (selectedPeriod === 'today') return tradeTs != null && tradeTs >= bounds.startMs && tradeTs < bounds.endMs && tradeTs <= now;
    if (selectedPeriod === '24h') return tradeTs != null && tradeTs >= now - 24 * 3600 * 1000 && tradeTs <= now;
    if (selectedPeriod === '7d') return tradeTs != null && tradeTs >= now - 7 * 24 * 3600 * 1000 && tradeTs <= now;
    if (selectedPeriod === '30d') return tradeTs != null && tradeTs >= now - 30 * 24 * 3600 * 1000 && tradeTs <= now;
    return true;
  };

  const dimensionFiltered = trades.filter((trade) => matchesDimensions(trade) && inPeriod(trade, period));
  const filtered = dimensionFiltered.filter(inScope);
  // Broker cash belongs to the whole account. A period or market filter must
  // not be reconciled against that balance, or the delta is a false gap.
  const fullBook = (!period || period === 'all') && !assetFilter && !productFilter;

  const baseSummary = summarizeTradeList(filtered, openCount, {
    startingBalance,
    observedBalance: fullBook ? observedBalance : null,
    openTrades: fullBook ? openTrades : [],
  });

  // Today uses the same profit sum as the headline, restricted to the local day.
  const todayTrades = trades.filter((trade) => matchesDimensions(trade) && inScope(trade) && inPeriod(trade, 'today'));
  const todayPnL = summarizeTradeList(todayTrades, 0, { includeCurve: false }).netPnL;

  // Compute total volume, average trade size, average duration
  let totalVolume = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const t of filtered) {
    const stake = Number(t.stake ?? t.risk_amount ?? 0);
    totalVolume += stake;
    const dur = Number(t.durationSec ?? t.expirationSize);
    if (Number.isFinite(dur) && dur > 0) {
      durationSum += dur;
      durationCount += 1;
    } else if (Number.isFinite(Number(t.expiryTime)) && Number.isFinite(Number(t.entryTime)) && Number(t.expiryTime) > Number(t.entryTime)) {
      durationSum += Math.round((Number(t.expiryTime) - Number(t.entryTime)) / 1000);
      durationCount += 1;
    }
  }

  const avgTradeSize = filtered.length > 0 ? Number((totalVolume / filtered.length).toFixed(2)) : 0;
  const avgDurationSec = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;

  // Breakdown by Trade Type / Product
  const productGroups = {
    binary: [],
    turbo: [],
    digital: [],
    blitz: [],
  };

  for (const t of filtered) {
    const prod = String(t.product || 'turbo').toLowerCase();
    if (!productGroups[prod]) productGroups[prod] = [];
    productGroups[prod].push(t);
  }

  const byProduct = {};
  for (const [prod, list] of Object.entries(productGroups)) {
    const s = summarizeTradeList(list, 0);
    let vol = 0;
    for (const item of list) vol += Number(item.stake ?? 0);
    byProduct[prod] = {
      product: prod,
      trades: list.length,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      winRate: s.winRate,
      netPnL: s.netPnL,
      profitFactor: s.profitFactor,
      volume: Number(vol.toFixed(2)),
    };
  }

  // Breakdown by Asset
  const assetMap = new Map();
  for (const t of filtered) {
    const sym = String(t.symbol || t.activeId || 'Unknown');
    if (!assetMap.has(sym)) assetMap.set(sym, []);
    assetMap.get(sym).push(t);
  }

  const byAsset = [];
  for (const [symbol, list] of assetMap.entries()) {
    const s = summarizeTradeList(list, 0);
    let vol = 0;
    for (const item of list) vol += Number(item.stake ?? 0);
    byAsset.push({
      symbol,
      activeId: list[0]?.activeId,
      trades: list.length,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      winRate: s.winRate,
      netPnL: s.netPnL,
      profitFactor: s.profitFactor,
      volume: Number(vol.toFixed(2)),
    });
  }
  byAsset.sort((a, b) => b.netPnL - a.netPnL);

  const bestAsset = byAsset.length > 0 && byAsset[0].netPnL > 0 ? byAsset[0] : null;
  const worstAsset = byAsset.length > 0 && byAsset[byAsset.length - 1].netPnL < 0 ? byAsset[byAsset.length - 1] : null;

  const result = {
    ...baseSummary,
    ...(scope ? { accountScope: scope } : {}),
    todayPnL,
    totalVolume: Number(totalVolume.toFixed(2)),
    avgTradeSize,
    avgDurationSec,
    avgDurationFormatted: formatDurationSec(avgDurationSec),
    byProduct,
    byAsset,
    bestAsset,
    worstAsset,
    equityCurve: baseSummary.equityCurve,
  };
  if (scope === 'combined') result.byAccount = balanceBook.accountBreakdown(filtered);
  return result;
}

module.exports = {
  summarizeTradeList,
  formatDurationSec,
  analyzeTradePerformance,
};
