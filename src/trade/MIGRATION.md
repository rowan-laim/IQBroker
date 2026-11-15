# Trade layer — structure and migration notes

Mirrors `candles/facade.js` + `candles/index.js`: everything is a small,
pure(ish), independently-testable module; `facade.js` composes them;
`index.js` re-exports the facade. `require('./trade')` is the only entry
point callers need.

```
trade/
  index.js              -> module.exports = require('./facade')
  facade.js              public API surface (mirrors candles/facade.js)

  durationGuard.js        pure: validate an expiry is finite/future/>=floor
  executionGuard.js        classify a broker reply: CONFIRMED / REJECTED / UNCERTAIN
  tradeEngine.js           orchestrator: prepare -> validate -> place -> record

  placement/
    registry.js            pluggable per-product placer registration
    turboPlacer.js
    blitzPlacer.js
    binaryPlacer.js
    digitalPlacer.js

  stakeSizing.js           pure: balance -> stake tier (was inline in tradeManager.js)
  settlement.js            pure: server push fields -> outcome/profit (was inline)
  metrics.js               pure: trade list -> win/loss/PnL summary (was inline)
  tradeManager.js           ledger only now: open/settle/index, no math, no stats

  tradeRecovery.js         unchanged, already standalone
  deferredExecutor.js      unchanged, already standalone
  categoryRouter.js        external dependency (stubbed here for testing only)
```

Each file has one job and no hidden coupling to the others except through
the arguments it's given — `durationGuard.js` doesn't know about brokers,
`executionGuard.js` doesn't know about durations, `tradeManager.js` doesn't
know about the broker or the network at all. That's what makes each one
cheap to unit test (see `smoke_test.js`) and safe to change in isolation.

## The bug, precisely

In the old `tradingEngine.js`, `executeSignal()`:

1. Computed `expired` from a product-specific selector
   (`selectTurboExpiry` / `selectBlitzDuration` + `blitzExpiryForDuration` /
   `binaryExpiryForDuration` / `instrument.expiration`).
2. Called `this.client.buyXXX(...)` with that `expired` **unconditionally**
   — nothing checked it was a finite, future timestamp first.
3. Called `this.tradeManager.recordPlacement(...)` **unconditionally**
   after the broker call resolved — nothing checked the broker actually
   accepted the order (no explicit-rejection check, no try/catch, no
   check that the reply carried a usable id).
4. If `expired` wasn't finite, it silently invented one:
   `expiryTime: Number.isFinite(expired) ? expired * 1000 : Date.now() + timeframeSeconds * 1000`.

So a 0-duration (or otherwise invalid) order could be sent, rejected by
the broker, and still get written into `tradeManager.openTrades` as an
`OPEN` trade — counted in win/loss/PnL stats — because nothing between
"broker responded" and "record it" ever asked "did this actually work?"

## The fix

Three independent gates, each in its own module, each enforced by
`tradeEngine.executeTrade()`:

1. **`durationGuard.assertValidExpiry()`** — runs *before* any broker call.
   Throws `InvalidDurationError` on non-finite, past, or sub-floor
   (`DEFAULT_MIN_DURATION_MS = 5000`) durations. No fallback value is ever
   substituted — a bad duration is a hard stop, not a "make something up."
2. **`executionGuard.guardedPlace()`** — runs the actual broker call and
   classifies the result as `CONFIRMED` / `REJECTED` / `UNCERTAIN`. An
   id-less, error-less reply is `UNCERTAIN`, not assumed success.
3. **`TradeManager.recordPlacement()`** itself now refuses to record a
   trade with a non-future `expiryTime`, and refuses to record an id-less
   trade that isn't explicitly flagged `unconfirmed: true` — so even a
   caller that bypasses `executeTrade()` and calls the ledger directly
   can't silently create a phantom open position.
4. **Live-account orders require `ctx.beforePlace()`** — the engine supplies
   this synchronous authorization gate, which rechecks the active account,
   signal freshness, balance, daily-loss limit, and total exposure after
   asynchronous placer preparation and immediately before the broker call.
   A direct live call without that gate fails closed.

`executeTrade()` only calls `recordPlacement()` on `CONFIRMED`. `REJECTED`
and unresolved `UNCERTAIN` always throw instead — there is no code path
from "broker said no" or "we don't know" to "counted as a trade."

## Wiring into `tradingEngine.js`

Replace the body of `executeSignal()` from `let res = null; ... return res;`
(the `if (asset.product === 'blitz') { ... } else if (...) { ... }` block
plus the `recordPlacement(...)` call) with:

```js
const { executeTrade } = require('../trade');

// ... after resolving `asset`, `quote`, `stake`, `stakeTier`, `userBalanceId`:

const { record, res } = await executeTrade({
  product: asset.product,
  client: this.client,
  tradeManager: this.tradeManager,
  asset,
  direction,
  timeframeSeconds,
  stake,
  wireValue,
  userBalanceId,
  signal,
  entryPrice: liveValue,
  account: this.config.account,
  stakeTier,
  balanceBefore: liveAmount,
  // Injected, so the trade layer never imports client/timing.js directly:
  deps: {
    selectTurboExpiry, blitzExpiryForDuration, selectBlitzDuration,
    binaryExpiryForDuration, selectDigitalInstrument, selectDigitalStrike,
  },
  getDigitalInstruments: (activeId) => this._getDigitalInstrumentsCached(activeId),
  onRecoverUncertain: async (err) => {
    // Optional: poll getPositions/getOrders and use tradeRecovery.pickBestMatch
    // to resolve an ambiguous/timed-out placement into a real id. Return the
    // recovered reply, or null/undefined to leave it UNCERTAIN (and therefore
    // un-recorded).
    return null;
  },
});

return res;
```

`executeSignal()` should let `executeTrade()`'s rejection propagate (or
catch it to emit a `tradeRejected` event) — it must **not** be swallowed
into a "place anyway" fallback, which is what reintroduces this bug.

Products other than the four built-ins (turbo/blitz/binary/digital) can be
added later with `trade.registerPlacer('newProduct', { prepare, place })`
— nothing else in this layer needs to change.
