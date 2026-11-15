const fs = require('fs');
const path = require('path');
const builtinModules = new Set(require('module').builtinModules);

console.log('Auditing broker directory for standalone isolation...\n');

const brokerRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(brokerRoot, 'package.json'), 'utf8'));
const allowedDeps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
]);

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') results = results.concat(walk(full));
    } else if (entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

const files = walk(brokerRoot);
console.log(`Found ${files.length} JavaScript files in broker/`);

let violations = 0;
const strategyTerms = ['signals/', 'bollinger/', 'displacement/', 'armed/', 'intelligence/', 'scanning/', 'persistence/db'];

for (const file of files) {
  const relFile = path.relative(brokerRoot, file);
  const content = fs.readFileSync(file, 'utf8');

  // Check for require statements
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const importPath = match[1];

    if (importPath.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), importPath);
      // Ensure the resolved path stays within brokerRoot
      if (!resolved.startsWith(brokerRoot)) {
        console.error(`❌ ESCAPED BROKER ROOT: ${relFile} requires "${importPath}" which resolves outside broker: ${resolved}`);
        violations++;
      } else {
        // Ensure file exists
        const exists = fs.existsSync(resolved) ||
          fs.existsSync(resolved + '.js') ||
          fs.existsSync(path.join(resolved, 'index.js')) ||
          fs.existsSync(resolved + '.json');
        if (!exists) {
          console.error(`❌ UNRESOLVED INTERNAL REQUIRE: ${relFile} requires "${importPath}" (file not found)`);
          violations++;
        }
      }
    } else {
      // External module or node builtin
      const rootModule = importPath.startsWith('node:')
        ? importPath.slice(5)
        : importPath.split('/')[0];

      if (!builtinModules.has(rootModule) && !allowedDeps.has(rootModule)) {
        console.error(`❌ UNDECLARED DEPENDENCY: ${relFile} requires external module "${importPath}" which is not in broker/package.json`);
        violations++;
      }
    }
  }

  // Check for forbidden strategy references in code
  for (const term of strategyTerms) {
    if (content.includes(term) && !relFile.includes('verify-standalone.js') && !relFile.includes('README.md')) {
      console.warn(`⚠️ Warning: potential strategy leakage in ${relFile}: found "${term}"`);
    }
  }
}

if (violations === 0) {
  console.log('\n🎉 SUCCESS: broker directory is 100% STANDALONE!');
  console.log('  - Zero references escaping the broker root.');
  console.log('  - All internal relative imports resolve cleanly.');
  console.log('  - All external imports are declared in broker/package.json or are Node built-ins.');
  process.exit(0);
} else {
  console.error(`\n❌ FAILED: ${violations} isolation violations found.`);
  process.exit(1);
}
