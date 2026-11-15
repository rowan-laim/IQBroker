const { METHOD, STREAM } = require('../../protocol/constants');

module.exports = (socket) => ({
  /**
   * Places a digital option trade.
   *
   * @param {object} p
   * @param {number} p.userBalanceId
   * @param {string} p.instrumentId - strike symbol, e.g. "do76A20260807D231900T1MPSPT"
   * @param {number|string} p.amount - stake; sent to the wire as a string
   * @param {number} p.instrumentIndex - parent instrument.index
   * @param {number} p.assetId
   * @returns {Promise<{id:number}>} order id
   */
  buyDigital({ userBalanceId, instrumentId, amount, instrumentIndex, assetId }) {
    if (!userBalanceId || !instrumentId || amount == null || instrumentIndex == null || !assetId) {
      throw new Error('buyDigital missing required field(s)');
    }
    if (typeof instrumentId !== 'string' || !instrumentId.startsWith('do')) {
      throw new Error(
        `buyDigital instrumentId must be a strike symbol (e.g. do76A...T1MCSPT), got ${JSON.stringify(instrumentId)}`
      );
    }
    return socket.call(
      METHOD.PLACE_DIGITAL_OPTION,
      {
        user_balance_id: userBalanceId,
        instrument_id: instrumentId,
        amount: String(amount),
        instrument_index: instrumentIndex,
        asset_id: assetId,
      },
      { version: '3.0' }
    );
  },

  buyDigitalOption(params) {
    return this.buyDigital(params);
  },

  getDigitalInstruments({ assetId, instrumentType = 'digital-option' }) {
    if (!assetId) throw new Error('getDigitalInstruments requires assetId');
    return socket.call(
      METHOD.GET_DIGITAL_INSTRUMENTS,
      { instrument_type: instrumentType, asset_id: assetId },
      { version: '3.0' }
    );
  },

  getDigitalUnderlyings({ filterSuspended } = {}) {
    const body = {};
    if (filterSuspended !== undefined) body.filter_suspended = filterSuspended;
    return socket.call(METHOD.GET_DIGITAL_UNDERLYINGS, body, { version: '3.0' });
  },

  /** Live digital strike prices/payout source for a specific instrument window. */
  subscribeDigitalPrice({ assetId, instrumentIndex }, onPrice) {
    if (!assetId || instrumentIndex == null) throw new Error('subscribeDigitalPrice requires assetId and instrumentIndex');
    const routingFilters = { instrument_type: 'digital-option', asset_id: assetId, instrument_index: instrumentIndex };
    const subscribeName = STREAM.DIGITAL_CLIENT_PRICE_SUBSCRIBE || 'trading-settings.digital-option-client-price-generated';
    socket.subscribe(subscribeName, { routingFilters }, { version: '1.0' });
    const handler = (msg) => {
      if (msg?.asset_id === assetId && msg?.instrument_index === instrumentIndex) onPrice(msg);
    };
    socket.on(`push:${STREAM.DIGITAL_CLIENT_PRICE}`, handler);
    return {
      unsubscribe: () => {
        socket.off(`push:${STREAM.DIGITAL_CLIENT_PRICE}`, handler);
        socket.unsubscribe(subscribeName, { routingFilters }, { version: '1.0' });
      },
    };
  },
});
