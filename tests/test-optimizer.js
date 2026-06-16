const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ModuleGraph = require('../src/module-graph');
const Optimizer = require('../src/optimizer');

function createTestFiles() {
  const testDir = path.join(__dirname, 'fixtures', 'optimizer');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  fs.writeFileSync(path.join(testDir, 'entry.js'), `
import { usedFunction, usedValue } from './utils';
import { usedOnlyHere } from './other';

console.log(usedFunction(usedValue));
console.log(usedOnlyHere);
`);

  fs.writeFileSync(path.join(testDir, 'utils.js'), `
export const usedValue = 42;
export const unusedValue = 100;

export function usedFunction(x) {
  return x * 2;
}

export function unusedFunction(x) {
  return x + 1;
}

export class UsedClass {
  constructor() {
    this.value = 0;
  }
}

export class UnusedClass {
  constructor() {
    this.value = 'unused';
  }
}
`);

  fs.writeFileSync(path.join(testDir, 'other.js'), `
export const usedOnlyHere = 'used';
export const unusedHere = 'not used';
`);

  return testDir;
}

function cleanup(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runTests() {
  console.log('=== Testing Optimizer (Tree-shaking) ===');
  let passed = 0;
  let failed = 0;

  const testDir = createTestFiles();

  try {
    const graph = new ModuleGraph();
    graph.addEntry(path.join(testDir, 'entry.js'));
    graph.build();

    const optimizer = new Optimizer({
      moduleGraph: graph,
      treeshake: true,
      sideEffects: true
    });

    optimizer.optimize();

    const utilsModule = graph.getModule(path.join(testDir, 'utils.js'));
    const otherModule = graph.getModule(path.join(testDir, 'other.js'));
    const entryModule = graph.getModule(path.join(testDir, 'entry.js'));

    assert.ok(utilsModule.usedExports.has('usedValue'), 'usedValue should be marked as used');
    assert.ok(utilsModule.usedExports.has('usedFunction'), 'usedFunction should be marked as used');
    passed++;
    console.log('✓ Marks used exports correctly');

    assert.ok(!utilsModule.usedExports.has('unusedValue'), 'unusedValue should not be marked as used');
    assert.ok(!utilsModule.usedExports.has('unusedFunction'), 'unusedFunction should not be marked as used');
    assert.ok(!utilsModule.usedExports.has('UnusedClass'), 'UnusedClass should not be marked as used');
    passed++;
    console.log('✓ Does not mark unused exports');

    const unusedExports = optimizer.getUnusedExports(utilsModule);
    assert.ok(unusedExports.length >= 2, 'Should have at least 2 unused exports');
    passed++;
    console.log('✓ Identifies unused exports correctly');

    const usedExports = optimizer.getUsedExports(utilsModule);
    assert.ok(usedExports.length >= 2, 'Should have at least 2 used exports');
    passed++;
    console.log('✓ Identifies used exports correctly');

    assert.ok(otherModule.usedExports.has('usedOnlyHere'), 'usedOnlyHere should be marked as used');
    assert.ok(!otherModule.usedExports.has('unusedHere'), 'unusedHere should not be marked as used');
    passed++;
    console.log('✓ Tracks exports across multiple modules');

    assert.ok(entryModule.optimizedSource, 'Entry module should have optimized source');
    assert.ok(utilsModule.optimizedSource, 'Utils module should have optimized source');
    passed++;
    console.log('✓ Generates optimized source code');

    assert.ok(utilsModule.removedRanges && utilsModule.removedRanges.length > 0, 'Should have removed code ranges');
    passed++;
    console.log('✓ Removes dead code ranges');

    const originalSize = utilsModule.parsed.source.length;
    const optimizedSize = utilsModule.optimizedSource.length;
    assert.ok(optimizedSize < originalSize, 'Optimized source should be smaller than original');
    passed++;
    console.log('✓ Reduces code size by removing dead code');

    assert.ok(entryModule.sideEffects, 'Entry module should have side effects (console.log)');
    passed++;
    console.log('✓ Detects side effects correctly');

  } catch (e) {
    failed++;
    console.log(`✗ Test failed: ${e.message}`);
    console.log(e.stack);
  } finally {
    cleanup(testDir);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

module.exports = { runTests };

if (require.main === module) {
  runTests();
}
