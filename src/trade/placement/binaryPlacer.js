function prepare(ctx) {
  const { timeframeSeconds, signal, deps } = ctx;
  const prepared = signal?.executionPreparation;
  const expired = prepared?.product === 'binary'
    ? prepared.expired
    : deps.binaryExpiryForDuration(timeframeSeconds);
  return { expired, expirationSize: null };
}

async function place(ctx, prepared) {
  const { client, userBalanceId, asset, direction, stake, wireValue } = ctx;
  return client.buyBinary({
    userBalanceId,
    activeId: asset.activeId,
    direction,
    expired: prepared.expired,
    price: stake,
    value: wireValue,
  });
}

module.exports = { product: 'binary', prepare, place };
