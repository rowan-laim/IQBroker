const { spawnSync } = require('child_process');
const path = require('path');

const testFiles = [
  'verify-standalone.js',
  'test_broker_facade.js',
  'test_socket.js',
  'test_candles.js',
  'test_http_login.js',
  'test_trade_guards.js',
];

console.log('====================================================');
console.log('🧪 RUNNING STANDALONE BROKER TEST SUITE');
console.log('====================================================\n');

let failed = 0;
for (const file of testFiles) {
  const fullPath = path.join(__dirname, file);
  console.log(`▶ Running ${file}...`);
  const result = spawnSync(process.execPath, [fullPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed++;
  }
}

console.log('====================================================');
if (failed === 0) {
  console.log(`🎉 ALL ${testFiles.length} BROKER TEST SUITES PASSED!`);
  console.log('====================================================');
  process.exit(0);
} else {
  console.error(`❌ ${failed} test suite(s) failed out of ${testFiles.length}.`);
  console.log('====================================================');
  process.exit(1);
}
