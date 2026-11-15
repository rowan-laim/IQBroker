const { METHOD, STREAM } = require('../../protocol/constants');

module.exports = (socket) => ({
  /** Returns the account's saved/custom indicator scripts from the captured API. */
  getScriptIndicators({ locale = 'en_US' } = {}) {
    return socket.call(METHOD.GET_SCRIPT_INDICATORS, { locale }, { version: '1.0' });
  },

  /** Subscribes to platform standard-indicator library definition changes. */
  subscribeStandardIndicatorLibrary(onChange) {
    const requestId = socket.subscribe(STREAM.STANDARD_LIBRARY_CHANGED, {}, { version: '1.0' });
    const handler = (msg) => onChange(msg);
    socket.on(`push:${STREAM.STANDARD_LIBRARY_CHANGED}`, handler);
    return {
      unsubscribe: () => {
        socket.off(`push:${STREAM.STANDARD_LIBRARY_CHANGED}`, handler);
        socket.unsubscribe(STREAM.STANDARD_LIBRARY_CHANGED, {}, { version: '1.0' });
      },
      requestId,
    };
  },
});
