/**
 * Blitz placer.
 */

function prepare(ctx) {
  const { asset, timeframeSeconds, signal, deps } = ctx;
  const prepared = signal?.executionPreparation;
  if (ctx.expired && ctx.expirationSize) {
    return { expired: ctx.expired, expirationSize: ctx.expirationSize };
  }
  if (prepared?.product === 'blitz') {
    return { expired: prepared.expired, expirationSize: prepared.expirationSize ?? null };
  }
  const expirationSize = ctx.expirationSize || deps.selectBlitzDuration(asset?.availableDurations, timeframeSeconds);
  const expired = ctx.expired || deps.blitzExpiryForDuration(expirationSize);
  return { expired, expirationSize };
}

async function place(ctx, prepared) {
  const { client, userBalanceId, asset, direction, stake, wireValue } = ctx;
  return client.buyBlitz({
    userBalanceId,
    activeId: asset.activeId,
    direction,
    expired: prepared.expired,
    price: stake,
    value: wireValue,
    expirationSize: prepared.expirationSize,
  });
}

module.exports = { product: 'blitz', prepare, place };
