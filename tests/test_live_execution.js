const { createClient, constants } = require('../index');
require('dotenv').config({ path: 'C:/Users/ROWAN/Desktop/OpenTrade/.env' });

async function run() {
  console.log('====================================================');
  console.log('🧪 LIVE PRACTICE EXECUTION & POSITION TRACKING TEST');
  console.log('====================================================\n');

  const client = createClient({ ssid: process.env.IQ_SSID, logLevel: 'warn' });
  await client.connect();
  const balance = await client.selectBalance({ type: constants.BALANCE_TYPE.PRACTICE });
  console.log(`💰 Connected. Practice Balance: $${balance.amount} (ID: ${balance.id})\n`);

  const activeId = 1381; // USD/SGD OTC

  // Listen to live WebSocket balance drops
  let balanceChangeCaptured = null;
  client.onBalanceChanged((b) => {
    console.log(`💳 [BALANCE CHANGE PUSH] id=${b.id} new_amount=$${b.amount}`);
    balanceChangeCaptured = b;
  });

  // Listen to live WebSocket position creations
  const capturedPositions = [];
  client.onPositionChanged((pos) => {
    console.log(`📍 [POSITION CHANGED PUSH]`, {
      id: pos.id,
      order_id: pos.order_id,
      active_id: pos.active_id,
      instrument_type: pos.instrument_type,
      open_quote: pos.open_quote, // Authoritative broker entry price!
      invest: pos.invest,
      dir: pos.dir,
      open_time: pos.open_time,
    });
    capturedPositions.push(pos);
  });

  // TEST 1: Digital Option Placement & Latency
  console.log('▶ [TEST 1] Placing Digital Option ($1 CALL)...');
  const dig = await client.getDigitalInstruments({ assetId: activeId });
  const instruments = dig?.instruments || [];
  const nowSec = Math.floor(Date.now() / 1000);
  const validInst = instruments.find((i) => Number(i.expiration) > nowSec + 30);
  if (!validInst) {
    console.log('  ⚠️ No open digital instrument available right now.');
  } else {
    const strike = validInst.data?.find((s) => s.strike === 'SPT' && s.direction === 'call');
    if (strike) {
      const t0 = Date.now();
      try {
        const res = await client.buyDigital({
          userBalanceId: balance.id,
          instrumentId: strike.symbol,
          amount: 1,
          instrumentIndex: validInst.index,
          assetId: activeId,
        });
        const latency = Date.now() - t0;
        console.log(`  ✅ Digital option executed! Round-trip latency: ${latency}ms | Order ID: ${res?.id || res?.order_id || JSON.stringify(res)}`);
      } catch (err) {
        console.error(`  ❌ Digital option failed: ${err.message}`);
      }
    }
  }

  // Wait 2s for pushes
  await new Promise((r) => setTimeout(r, 2000));

  // TEST 2: Turbo Placement & Sub-200ms Latency
  console.log('\n▶ [TEST 2] Placing Turbo Option ($1 CALL)...');
  const init = await client.getInitializationData();
  const turboActive = init.turbo?.actives?.[String(activeId)];
  if (turboActive && !turboActive.is_suspended) {
    const gridSeconds = Number(turboActive.option?.exp_time || 60);
    const start = Number(turboActive.option?.start_time || 0);
    const phase = ((start % gridSeconds) + gridSeconds) % gridSeconds;
    const now = Math.floor(Date.now() / 1000);
    let expired = Math.floor(now / gridSeconds) * gridSeconds + phase;
    if (expired < now + 15) expired += gridSeconds;

    const t0 = Date.now();
    try {
      const res = await client.buyTurbo({
        userBalanceId: balance.id,
        activeId,
        direction: 'call',
        expired,
        price: 1.25,
        value: 1,
      });
      const latency = Date.now() - t0;
      console.log(`  ✅ Turbo option executed! Round-trip latency: ${latency}ms | Order ID: ${res?.id}`);
    } catch (err) {
      console.error(`  ❌ Turbo option failed: ${err.message}`);
    }
  } else {
    console.log('  ⚠️ Turbo active suspended.');
  }

  // Wait 2s for pushes
  await new Promise((r) => setTimeout(r, 2000));

  // TEST 3: Blitz Placement & Sub-200ms Latency
  console.log('\n▶ [TEST 3] Placing Blitz Option ($1 CALL, 15s)...');
  const blitzActive = init.blitz?.actives?.[String(activeId)];
  if (blitzActive && !blitzActive.is_suspended) {
    const expirationSize = 15;
    const now = Math.floor(Date.now() / 1000);
    const expired = now + expirationSize;

    const t0 = Date.now();
    try {
      const res = await client.buyBlitz({
        userBalanceId: balance.id,
        activeId,
        direction: 'call',
        expired,
        price: 1.25,
        value: 1,
        expirationSize,
      });
      const latency = Date.now() - t0;
      console.log(`  ✅ Blitz option executed! Round-trip latency: ${latency}ms | Order ID: ${res?.id}`);
    } catch (err) {
      console.error(`  ❌ Blitz option failed: ${err.message}`);
    }
  } else {
    console.log('  ⚠️ Blitz active suspended.');
  }

  // Wait 3s for final pushes to settle
  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n====================================================');
  console.log(`📊 SUMMARY OF POSITION PUSHES RECEIVED: ${capturedPositions.length}`);
  for (const p of capturedPositions) {
    console.log(`  - Type: ${p.instrument_type} | ID: ${p.order_id || p.id} | Entry Price (open_quote): ${p.open_quote} | Stake: $${p.invest}`);
  }
  console.log('====================================================');

  await client.disconnect();
}

run().catch(console.error);
