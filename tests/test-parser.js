const fs = require('fs');
const path = require('path');
const assert = require('assert');
const DependencyParser = require('../src/parser');

function runTests() {
  console.log('=== Testing DependencyParser ===');
  let passed = 0;
  let failed = 0;

  const testDir = path.join(__dirname, 'fixtures');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testFile = path.join(testDir, 'test-module.js');
  const testContent = `
import { a, b } from './module-a';
import c from './module-b';
import * as d from './module-c';

export const foo = 42;
export function bar() { return 'bar'; }
export default function() { return 'default'; }

const unused = 'this is unused';
function unusedFn() {}

console.log(a + b + c);

if (true) {
  import('./lazy').then(m => console.log(m));
}
`;

  fs.writeFileSync(testFile, testContent);

  try {
    const parser = new DependencyParser();
    const result = parser.parse(testFile);

    assert.strictEqual(result.imports.length, 3, 'Should have 3 imports');
    passed++;
    console.log('✓ Parses import statements correctly');

    assert.strictEqual(result.imports[0].specifiers.length, 2, 'First import should have 2 specifiers');
    passed++;
    console.log('✓ Parses import specifiers correctly');

    assert.strictEqual(result.imports[1].specifiers[0].type, 'ImportDefaultSpecifier', 'Second import should be default');
    passed++;
    console.log('✓ Recognizes default import');

    assert.strictEqual(result.imports[2].specifiers[0].type, 'ImportNamespaceSpecifier', 'Third import should be namespace');
    passed++;
    console.log('✓ Recognizes namespace import');

    assert.strictEqual(result.exports.length, 3, 'Should have 3 exports');
    passed++;
    console.log('✓ Parses export statements correctly');

    const namedExports = result.exports.filter(e => e.type === 'named');
    assert.strictEqual(namedExports.length, 2, 'Should have 2 named exports');
    passed++;
    console.log('✓ Recognizes named exports');

    const defaultExport = result.exports.find(e => e.type === 'default');
    assert.ok(defaultExport, 'Should have default export');
    passed++;
    console.log('✓ Recognizes default export');

    assert.strictEqual(result.dynamicImports.length, 1, 'Should have 1 dynamic import');
    passed++;
    console.log('✓ Recognizes dynamic import');

    assert.strictEqual(result.dynamicImports[0].source, './lazy', 'Dynamic import source should be ./lazy');
    passed++;
    console.log('✓ Parses dynamic import source correctly');

    assert.ok(result.ast, 'Should have AST');
    assert.ok(result.source, 'Should have source');
    passed++;
    console.log('✓ Returns AST and source');

  } catch (e) {
    failed++;
    console.log(`✗ Test failed: ${e.message}`);
    console.log(e.stack);
  } finally {
    fs.unlinkSync(testFile);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

module.exports = { runTests };

if (require.main === module) {
  runTests();
}
