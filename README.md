# IQBroker (`iqbroker`)

High-performance, framework-agnostic headless client for IQ Option (Quadcode protocol).

This library provides the complete broker connection, candle retrieval, balance management, and trade execution pipeline **completely decoupled from any proprietary strategy, pattern scanning, or indicator engine**.

---

## Features

1. **Broker Connection**:
   - **Headless HTTP Login**: `email + password -> session token (SSID)` in < 1 second.
   - **Browser-Assisted Connection**: Automated Chromium session capture via Playwright & Chrome DevTools Protocol (CDP) to extract session cookies or bypass 2FA.
   - **Quadcode WebSocket Protocol (`IQSocket`)**: Persistent multiplexed WebSocket client with $O(1)$ request-id correlation, heartbeats (`timeSync`), and exponential-backoff auto-reconnection.
   - **Session Lifecycle & Auto-Refresh**: Automatically requests fresh sessions when tokens expire without dropping application state.

2. **Candle Retrieval**:
   - Historical candles (`getCandles`, `getFirstCandles`) with split normalization and closed-candle filtering.
   - Real-time candle streaming (`subscribeCandles`) for custom chart timeframes.
   - Live tick quotes (`subscribeQuotes`).

3. **Balance Management**:
   - Fetching multi-wallet balances (`getBalances`, `getBalance`): Real, Practice (Demo), and Tournament.
   - Local and remote balance switching (`selectBalance`).
   - Push-based balance change listeners (`subscribeBalanceChanged`, `onBalanceChanged`).
   - Profile information (`getProfile`).

4. **Asset & Schedule Resolution**:
   - Instrument metadata and human-friendly display name resolution (`resolveActive`, `getActive`).
   - Trading schedules and tradability filtering (`parseAssetSchedule`, `selectTradeableAssets`).
   - Product commissions and initialization bundles (`getInitializationData`, `getTradingGroupParams`).

5. **Safe Trade Execution**:
   - Full product coverage: **Turbo**, **Binary**, **Blitz**, and **Digital** options.
   - **`durationGuard`**: Strict pre-flight checks against 0-duration, sub-minimum, or past expiries.
   - **`executionGuard`**: Explicit classification of broker responses into `CONFIRMED`, `REJECTED`, and `UNCERTAIN`.
   - **`TradeManager`**: In-memory lifecycle ledger tracking open positions, order IDs, and server settlement pushes without coupling to analytics.
   - Pluggable Placers: Easily customizable placement handlers for each option type.
   - Early close: `sellOptions` (buyback).

---

## Installation

```bash
npm install iqbroker
```
or from local path:
```bash
npm install /path/to/IQBroker
```

If you plan to use browser-assisted session capture (optional):
```bash
npm install playwright
```

---

## Environment Setup

Create a `.env` file or export environment variables:

```env
IQ_EMAIL=trader@example.com
IQ_PASSWORD=your_password

# Optional: Stored SSID (only used if email/password are not set)
# IQ_SSID=stored_session_token

# Optional: WebSocket & Auth endpoints
# IQ_WS_URL=wss://ws.iqoption.com/echo/websocket
# IQ_LOGIN_URL=https://auth.iqoption.com/api/v2/login
```

---

## Quickstart

### 1. Connect and Fetch Balances

```javascript
const { createClient, constants } = require('iqbroker');

async function main() {
  // Automatically logs in headlessly with IQ_EMAIL / IQ_PASSWORD
  const client = createClient();
  await client.connect();
  console.log('Connected to broker!');

  // Retrieve balances
  const balances = await client.getBalances();
  console.log('Available balances:', balances);

  // Switch to Practice balance
  const practice = await client.selectBalance({ type: constants.BALANCE_TYPE.PRACTICE });
  console.log(`Using practice account #${practice.id} ($${practice.amount})`);

  // Listen for balance updates
  const sub = client.subscribeBalanceChanged((balance) => {
    console.log(`Balance updated: $${balance.amount}`);
  });
}

main().catch(console.error);
```

### 2. Connect via Browser Session (Playwright)

When an account requires 2FA or interactive captcha:

```javascript
const { captureBrowserSession, BrokerClient } = require('iqbroker');

async function main() {
  console.log('Launching browser to capture session...');
  const { ssid, close } = await captureBrowserSession({
    headless: false, // Opens visible browser for login
    saveToEnv: true, // Automatically writes IQ_SSID to .env
  });

  console.log('Captured SSID, connecting headless client...');
  const client = new BrokerClient({ ssid });
  await client.connect();

  await close(); // Close browser once token is acquired
}

main().catch(console.error);
```

### 3. Stream Historical and Live Candles

```javascript
const { createClient } = require('iqbroker');

async function main() {
  const client = createClient();
  await client.connect();

  const activeId = 76; // EURUSD-OTC
  const size = 60;     // 1-minute candles

  // Historical candles
  const history = await client.getCandles({
    activeId,
    size,
    count: 20,
    onlyClosed: true,
  });
  console.log(`Loaded ${history.length} historical candles.`);

  // Live streaming
  const subscription = client.subscribeCandles({ activeId, size }, (candle) => {
    console.log(`[EURUSD-OTC] Open: ${candle.open}, Close: ${candle.close}`);
  });

  // Stop streaming after 30 seconds
  setTimeout(() => subscription.unsubscribe(), 30000);
}

main().catch(console.error);
```

### 4. Safe Trade Execution

```javascript
const { createClient, timing, trade } = require('iqbroker');

async function main() {
  const client = createClient();
  await client.connect();

  // Select Practice account
  await client.selectBalance({ type: 4 });

  const activeId = 76;
  const active = await client.resolveActive(activeId);
  const initData = await client.getInitializationData();
  const turboInit = initData?.turbo?.actives?.[String(activeId)];

  // Select valid expiry
  const expired = timing.selectTurboExpiry(turboInit, 60);

  // Guarded trade execution
  const tradeManager = new trade.TradeManager({ stake: 1 });
  const result = await trade.executeTrade({
    product: 'turbo',
    direction: 'call',
    stake: 1,
    asset: { activeId, symbol: active.symbol, raw: turboInit },
    client,
    tradeManager,
    deps: { selectTurboExpiry: timing.selectTurboExpiry },
    userBalanceId: client.balanceId,
    entryPrice: 1.1020,
    wireValue: 110200,
  });

  console.log('Trade placed safely:', result.record);
}

main().catch(console.error);
```

---

## Module Reference

| Export | Type | Description |
| :--- | :--- | :--- |
| `BrokerClient` / `IQClient` | Class | Main client facade multiplexing all socket methods |
| `createClient` | Function | Factory creating an auto-refreshing `BrokerClient` from environment |
| `loginWithPassword` | Function | Headless HTTP POST login (`email + password -> SSID`) |
| `captureBrowserSession`| Function | Playwright-based browser session capture via CDP |
| `ConnectionLayer` | Class | Event-driven connection manager (`connected`, `disconnected`) |
| `IQSocket` | Class | Low-level WebSocket protocol transport |
| `constants` | Object | Protocol constants (`BALANCE_TYPE`, `OPTION_TYPE_ID`, `STREAM`, `METHOD`) |
| `timing` | Object | Expiry calculation algorithms for Turbo, Binary, Blitz, and Digital |
| `assetFilter` | Object | Asset schedules, active filters, and trading hour checkers |
| `trade` | Object | `TradeManager`, `executeTrade`, `durationGuard`, `executionGuard`, placers |

---

## License

MIT
