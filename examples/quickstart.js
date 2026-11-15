/**
 * Broker Quickstart Example
 *
 * Demonstrates:
 *   1. Connecting to the broker
 *   2. Fetching profile and balances
 *   3. Switching to Practice balance
 *   4. Resolving active metadata
 *   5. Fetching historical candles & subscribing to live ticks
 *
 * Usage:
 *   node examples/quickstart.js
 */
const { createClient, constants } = require('../index');

async function main() {
  console.log('--- OpenIQ Broker Quickstart ---');

  const client = createClient();
  console.log('Connecting to IQ Option broker...');
  await client.connect();
  console.log('✅ Connected and authenticated!');

  // 1. Profile
  try {
    const profile = await client.getProfile();
    const info = profile?.result || profile;
    console.log(`👤 User: ${info.name || 'Trader'} (ID: ${info.user_id || info.userId})`);
  } catch (err) {
    console.warn('Could not fetch profile:', err.message);
  }

  // 2. Balances
  console.log('\nFetching account balances:');
  const balances = await client.getBalances();
  for (const b of balances) {
    const kind = b.type === constants.BALANCE_TYPE.REAL
      ? 'REAL'
      : b.type === constants.BALANCE_TYPE.PRACTICE
        ? 'PRACTICE'
        : `TYPE_${b.type}`;
    console.log(`  [${kind}] ID: ${b.id} | Amount: $${b.amount} ${b.currency}`);
  }

  // 3. Select Practice Balance
  const practice = await client.selectBalance({ type: constants.BALANCE_TYPE.PRACTICE });
  console.log(`\n🎯 Selected practice balance #${practice.id} ($${practice.amount})`);

  // 4. Resolve Active
  const activeId = 76; // EURUSD-OTC
  const active = await client.resolveActive(activeId);
  console.log(`\n📊 Active ${activeId}: ${active.description} (Symbol: ${active.symbol}, Precision: ${active.precision})`);

  // 5. Historical Candles
  console.log(`\nFetching last 5 candles (1m) for ${active.symbol}:`);
  const candles = await client.getCandles({
    activeId,
    size: 60,
    count: 5,
    onlyClosed: true,
  });
  const list = Array.isArray(candles) ? candles : candles?.data || [];
  for (const c of list.slice(-5)) {
    console.log(`  Candle #${c.id || c.from}: Open=${c.open} Close=${c.close} High=${c.high} Low=${c.low}`);
  }

  // 6. Live Quotes
  console.log('\nListening for live quote ticks (5 seconds)...');
  const quoteSub = client.subscribeQuotes({ activeId }, (tick) => {
    console.log(`  Tick: Ask=${tick.ask} Bid=${tick.bid} Value=${tick.value}`);
  });

  await new Promise((resolve) => setTimeout(resolve, 5000));
  quoteSub.unsubscribe();
  console.log('Unsubscribed from quotes.');

  client.disconnect();
  console.log('✅ Disconnected cleanly.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err.message || err);
    process.exit(1);
  });
}
