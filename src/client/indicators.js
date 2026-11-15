function closes(candles) {
  const values = candles.map((candle) => Number(candle?.close ?? candle?.close_price ?? candle?.value));
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Each candle needs a numeric close/value');
  return values;
}

function requirePeriod(values, period) {
  if (!Number.isInteger(period) || period <= 0 || values.length < period) throw new Error(`Need at least ${period} candle closes`);
}

function sma(candles, period = 20) {
  const values = closes(candles);
  requirePeriod(values, period);
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function ema(candles, period = 20) {
  const values = closes(candles);
  requirePeriod(values, period);
  const multiplier = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  for (const close of values.slice(period)) value = (close - value) * multiplier + value;
  return value;
}

function rsi(candles, period = 14) {
  const values = closes(candles);
  requirePeriod(values, period + 1);
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function bollingerBands(candles, period = 20, deviations = 2) {
  const values = closes(candles);
  requirePeriod(values, period);
  const sample = values.slice(-period);
  const middle = sample.reduce((sum, value) => sum + value, 0) / period;
  const standardDeviation = Math.sqrt(sample.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period);
  return { lower: middle - deviations * standardDeviation, middle, upper: middle + deviations * standardDeviation };
}

function calculateIndicators(candles, { smaPeriod = 20, emaPeriod = 20, rsiPeriod = 14, bollingerPeriod = 20 } = {}) {
  return {
    sma: sma(candles, smaPeriod),
    ema: ema(candles, emaPeriod),
    rsi: rsi(candles, rsiPeriod),
    bollinger: bollingerBands(candles, bollingerPeriod),
  };
}

module.exports = { sma, ema, rsi, bollingerBands, calculateIndicators };
