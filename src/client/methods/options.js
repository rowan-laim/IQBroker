const { METHOD, OPTION_TYPE_ID, DIRECTION } = require('../../protocol/constants');

function assertDirection(direction) {
  if (direction !== DIRECTION.CALL && direction !== DIRECTION.PUT) {
    throw new Error(`direction must be "call" or "put", got "${direction}"`);
  }
}

module.exports = (socket) => {
  /**
   * Shared implementation for turbo/binary/blitz.
   */
  function openOption({
    userBalanceId,
    activeId,
    optionTypeId,
    direction,
    expired,
    price,
    value,
    profitPercent = 0,
    refundValue = 0,
    expirationSize,
  }) {
    assertDirection(direction);
    if (!userBalanceId || !activeId || !expired || price == null || value == null) {
      throw new Error('openOption missing required field(s)');
    }
    if (!(price > 0)) throw new Error(`openOption price must be > 0, got ${price}`);
    const body = {
      user_balance_id: userBalanceId,
      active_id: activeId,
      option_type_id: optionTypeId,
      direction,
      expired,
      refund_value: refundValue,
      price,
      value,
      profit_percent: profitPercent,
    };
    if (expirationSize !== undefined) body.expiration_size = expirationSize;

    return socket.call(METHOD.OPEN_OPTION, body, { version: '2.0' });
  }

  return {
    /**
     * Places a Turbo option trade.
     * @param {object} p
     * @param {number} p.userBalanceId
     * @param {number} p.activeId
     * @param {'call'|'put'} p.direction
     * @param {number} p.expired - unix seconds
     * @param {number} p.price - stake amount
     * @param {number} p.value - integer wire quote
     * @param {number} [p.profitPercent]
     */
    buyTurbo(p) {
      return openOption({ ...p, optionTypeId: OPTION_TYPE_ID.TURBO });
    },

    /**
     * Places a Binary option trade.
     */
    buyBinary(p) {
      return openOption({ ...p, optionTypeId: OPTION_TYPE_ID.BINARY });
    },

    /**
     * Places a Blitz option trade.
     * @param {object} p - same as buyTurbo, plus:
     * @param {number} p.expirationSize - window size in seconds (e.g. 30)
     */
    buyBlitz(p) {
      if (!p.expirationSize) throw new Error('buyBlitz requires expirationSize');
      return openOption({ ...p, optionTypeId: OPTION_TYPE_ID.BLITZ });
    },

    /**
     * Early-close one or more open options (buyback).
     * @param {{optionIds: number[]}|number[]} optionIds
     * @returns {Promise<object>} "sold-options" reply with per-id results
     */
    sellOptions(optionIds) {
      const ids = Array.isArray(optionIds) ? optionIds : optionIds?.optionIds;
      if (!ids?.length) throw new Error('sellOptions requires optionIds');
      return socket.call(METHOD.SELL_OPTIONS, { options_ids: ids }, { version: '4.0' });
    },

    /**
     * Extends an already-open blitz option to a new expiry.
     * @param {{optionId:number, expirationTime:number}} p
     */
    rolloverOption({ optionId, expirationTime }) {
      if (!optionId || !expirationTime) {
        throw new Error('rolloverOption requires optionId and expirationTime');
      }
      return socket.call(
        METHOD.ROLLOVER_OPTION,
        { option_id: optionId, expiration_time: expirationTime },
        { version: '1.0' }
      );
    },
  };
};
