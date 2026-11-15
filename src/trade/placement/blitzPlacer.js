/**
 * Blitz placer. This is the product most directly implicated in the
 * 0-duration bug: selectBlitzDuration() picking an empty/zero entry from
 * asset.availableDurations used to flow straight into blitzExpiryForDuration()
 * and then straight into client.buyBlitz() with nothing checking the
 * result was a sane future timestamp.
 */

function prepare(ctx) {
  const { asset, timeframeSeconds, signal, deps } = ctx;
  const prepared = signal?.executionPreparation;
  if (prepared?.product === 'blitz') {
    return { expired: prepared.expired, expirationSize: prepared.expirationSize ?? null };
  }
  const expirationSize = deps.selectBlitzDuration(asset.availableDurations, timeframeSeconds);
  const expired = deps.blitzExpiryForDuration(expirationSize);
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
