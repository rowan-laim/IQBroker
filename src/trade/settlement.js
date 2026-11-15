/**
 * Settlement
 *
 * Pure translation from raw server push shapes (position-changed /
 * order-changed / recovered rows) into { outcome, profit, ids }.
 * Extracted out of TradeManager so it can be tested against captured
 * server payloads without spinning up the whole ledger.
 */

const TERMINAL_CLOSE_REASONS = new Set([
  'win', 'won', 'loose', 'lose', 'lost', 'loss',
  'equal', 'tie', 'draw', 'sold', 'expired',
]);

function isClosedPosition(msg, raw) {
  const status = String(msg?.status || raw?.status || '').toLowerCase();
  if (status === 'closed') return true;
  const reason = String(msg?.close_reason || raw?.close_reason || raw?.result || '').toLowerCase();
  return TERMINAL_CLOSE_REASONS.has(reason);
}

function collectPositionIds(msg, raw) {
  const ids = [];
  const push = (v) => {
    if (v != null && v !== '') ids.push(v);
  };
  push(msg.external_id);
  push(msg.id);
  push(raw?.option_id);
  push(raw?.id);
  push(raw?.position_id);
  if (Array.isArray(raw?.order_ids)) raw.order_ids.forEach(push);
  push(raw?.order_id);
  return ids;
}

/**
 * Map platform close fields → WIN / LOSS / TIE.
 * Capture examples:
 *   turbo win:   close_reason=win,    close_profit=18.6, pnl_net=+8.6
 *   turbo loss:  close_reason=loose,  close_profit=0,    pnl_net=-10
 *   digital win: close_reason=expired, close_profit=18.51, pnl_net=+8.51
 *   sold early:  close_reason=sold,   raw.result=sold — treat via pnl
 */
function outcomeFromPosition(msg, raw, trade) {
  const reason = String(msg.close_reason || raw?.close_reason || raw?.result || raw?.win || '').toLowerCase();
  if (reason === 'win' || reason === 'won') return 'WIN';
  if (reason === 'loose' || reason === 'lose' || reason === 'lost' || reason === 'loss') return 'LOSS';
  if (reason === 'equal' || reason === 'tie' || reason === 'draw') return 'TIE';

  const pnl = Number(msg.pnl_net ?? msg.pnl_realized ?? raw?.pnl_realized ?? raw?.pnl_net);
  if (Number.isFinite(pnl)) {
    if (pnl > 0.0001) return 'WIN';
    if (pnl < -0.0001) return 'LOSS';
    return 'TIE';
  }

  const closeProfit = Number(msg.close_profit ?? msg.close_effect_amount ?? raw?.close_effect_amount);
  const invest = Number(msg.invest ?? raw?.buy_amount ?? trade.stake);
  if (Number.isFinite(closeProfit) && Number.isFinite(invest)) {
    if (closeProfit > invest + 0.0001) return 'WIN';
    if (closeProfit < 0.0001) return 'LOSS';
    if (Math.abs(closeProfit - invest) < 0.0001) return 'TIE';
  }
  return null;
}

function profitFromPosition(msg, raw, trade) {
  const pnl = Number(msg.pnl_net ?? msg.pnl_realized ?? raw?.pnl_realized);
  if (Number.isFinite(pnl)) return pnl;

  const closeProfit = Number(msg.close_profit ?? msg.close_effect_amount ?? raw?.close_effect_amount);
  const invest = Number(msg.invest ?? raw?.buy_amount ?? trade.stake);
  if (Number.isFinite(closeProfit) && Number.isFinite(invest)) {
    return closeProfit - invest;
  }
  return null;
}

module.exports = { collectPositionIds, outcomeFromPosition, profitFromPosition, isClosedPosition };
