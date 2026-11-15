/**
 * Stake Sizing
 *
 * Pure balance -> stake-tier lookup. No I/O, no class state — extracted
 * out of TradeManager so it can be unit tested and swapped independently
 * (e.g. a caller can pass a custom `tiers` table without touching trade
 * lifecycle code at all).
 */

const DEFAULT_STAKE_TIERS = Object.freeze([
  { min: 0, max: 0, stake: 0, label: 'BLOCKED' },
  { min: 1, max: 9.99, stake: 1, label: '$1' },
  { min: 10, max: 19.99, stake: 2, label: '$2' },
  { min: 20, max: 29.99, stake: 3, label: '$3' },
  { min: 30, max: 70.99, stake: 5, label: '$5' },
  { min: 71, max: 120.99, stake: 10, label: '$10' },
  { min: 121, max: 250.99, stake: 20, label: '$20' },
  { min: 251, max: 700.99, stake: 50, label: '$50' },
  { min: 701, max: 1200.99, stake: 100, label: '$100' },
  { min: 1201, max: 2500.99, stake: 200, label: '$200' },
  { min: 2501, max: 4999.99, stake: 300, label: '$300' },
  { min: 5000, max: 9999.99, stake: 500, label: '$500' },
  { min: 10000, max: 24999.99, stake: 1000, label: '$1,000' },
  { min: 25000, max: Infinity, stake: 2000, label: '$2,000' },
]);

/**
 * Looks up the stake tier for a given account balance.
 * Caller supplies the balance (e.g. engine reads it from the broker
 * client before placing) — this function has no side effects.
 */
function resolveStakeFromBalance(balance, tiers = DEFAULT_STAKE_TIERS) {
  const bal = Number(balance);
  if (!Number.isFinite(bal) || bal < 1) return { stake: 0, label: 'BLOCKED' };

  const ordered = [...tiers]
    .filter((t) => t && Number.isFinite(Number(t.min)))
    .sort((a, b) => Number(a.min) - Number(b.min));
  if (!ordered.length) return { stake: 0, label: 'BLOCKED' };

  // Greatest min <= balance. Exact [min, max] wins when present; range gaps
  // (e.g. 70.50 between max 70 and min 71) stay in the lower tier instead of
  // falling through to the last / highest stake.
  let chosen = null;
  for (const t of ordered) {
    const min = Number(t.min);
    const max = t.max == null || t.max === Infinity ? Infinity : Number(t.max);
    if (bal >= min && bal <= max) chosen = t;
    else if (bal >= min) chosen = t;
  }
  if (!chosen) return { stake: 0, label: 'BLOCKED' };

  const idx = ordered.indexOf(chosen);
  for (let i = idx; i >= 0; i--) {
    const stake = Number(ordered[i].stake);
    if (stake > 0 && stake <= bal) {
      return { stake, label: ordered[i].label };
    }
  }
  return { stake: 0, label: 'BLOCKED' };
}

module.exports = { DEFAULT_STAKE_TIERS, resolveStakeFromBalance };
