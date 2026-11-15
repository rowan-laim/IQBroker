/**
 * Digital placer. Instrument/strike selection needs an async instrument
 * list, so prepare() is async here (the registry/tradeEngine always await
 * prepare() regardless of product, so this is transparent to callers).
 *
 * Digital durations are 1m / 5m / 15m, never 0s / 1s leftover windows.
 */

const { assertValidExpiry } = require('../durationGuard');
const {
  digitalPeriodSeconds,
  instrumentPeriodSeconds,
  digitalMinRemainingSec,
  digitalInstrumentStillValid,
} = require('../../client/timing');

function instrumentRows(reply) {
  const rows = reply?.instruments ?? reply?.result?.instruments ?? reply;
  return Array.isArray(rows) ? rows : [];
}

function sameDigitalWindow(row, selected) {
  return row && selected && String(row.index) === String(selected.index)
    && instrumentPeriodSeconds(row.period) === instrumentPeriodSeconds(selected.period)
    && Number(row.expiration) === Number(selected.expiration);
}

async function prepare(ctx) {
  const { asset, timeframeSeconds, direction, signal, deps, getDigitalInstruments } = ctx;
  const prepared = signal?.executionPreparation;
  const periodSec = digitalPeriodSeconds(timeframeSeconds);

  let instrument = prepared?.product === 'digital' ? prepared.digital?.instrument : null;
  if (!digitalInstrumentStillValid(instrument, timeframeSeconds)) {
    instrument = null;
  }
  if (!instrument) {
    instrument = deps.selectDigitalInstrument(
      await getDigitalInstruments(asset.activeId),
      periodSec,
      Math.floor(Date.now() / 1000),
    );
  }
  if (!instrument) {
    throw new Error(`No digital instrument found for asset ${asset.activeId} with period ${periodSec / 60}m`);
  }

  let strike = (prepared?.product === 'digital' && prepared.digital?.instrument === instrument)
    ? prepared.digital?.strikes?.[direction]
    : deps.selectDigitalStrike(instrument, direction);

  // The get-instruments response can arrive before its strike rows are
  // populated. Re-read metadata once, but only accept the same instrument
  // window so a refresh cannot silently move this trade to another contract.
  if (!strike?.symbol && typeof getDigitalInstruments === 'function') {
    const refreshed = instrumentRows(await getDigitalInstruments(asset.activeId))
      .find((row) => sameDigitalWindow(row, instrument));
    if (refreshed) {
      const refreshedStrike = deps.selectDigitalStrike(refreshed, direction);
      if (refreshedStrike?.symbol) {
        instrument = refreshed;
        strike = refreshedStrike;
      }
    }
  }
  if (!strike?.symbol) {
    throw new Error(
      `Digital SPT ${direction} strike unavailable in instrument metadata ` +
      `(asset=${asset.activeId}, index=${instrument.index}, period=${instrument.period}, expiration=${instrument.expiration})`
    );
  }

  const expired = Number(instrument.expiration);
  const expirationSize = instrumentPeriodSeconds(instrument.period) || periodSec;
  assertValidExpiry(expired, {
    now: Date.now(),
    minDurationMs: digitalMinRemainingSec(expirationSize) * 1000,
    label: 'digital',
  });

  return { expired, expirationSize, instrument, strike };
}

async function place(ctx, prepared) {
  const { client, userBalanceId, asset, stake } = ctx;
  const res = await client.buyDigital({
    userBalanceId,
    instrumentId: prepared.strike.symbol,
    amount: stake,
    instrumentIndex: prepared.instrument.index,
    assetId: asset.activeId,
  });
  return { ...res, _digitalStrike: prepared.strike.symbol, _instrumentIndex: prepared.instrument.index };
}

module.exports = { product: 'digital', prepare, place };
