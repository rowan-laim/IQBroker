/**
 * Turbo placer. Duration selection is injected via ctx.deps.selectTurboExpiry
 * (normally backed by client/timing.js) so this module has zero knowledge
 * of broker timing internals and can be unit tested with a stub.
 */

function prepare(ctx) {
  const { asset, timeframeSeconds, signal, deps } = ctx;
  const prepared = signal?.executionPreparation;
  if (ctx.expired) {
    return { expired: ctx.expired, expirationSize: null };
  }
  if (prepared?.product === 'turbo') {
    return { expired: prepared.expired, expirationSize: null };
  }
  const expired = deps.selectTurboExpiry(asset?.raw, timeframeSeconds);
  return { expired, expirationSize: null };
}

async function place(ctx, prepared) {
  const { client, userBalanceId, asset, direction, stake, wireValue } = ctx;
  return client.buyTurbo({
    userBalanceId,
    activeId: asset.activeId,
    direction,
    expired: prepared.expired,
    price: stake,
    value: wireValue,
  });
}

module.exports = { product: 'turbo', prepare, place };
