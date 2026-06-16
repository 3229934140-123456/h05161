const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ModuleGraph = require('../src/module-graph');

function createTestFiles() {
  const testDir = path.join(__dirname, 'fixtures', 'graph');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  fs.writeFileSync(path.join(testDir, 'a.js'), `
import { b } from './b';
import { c } from './c';
export const a = 1;
export function useB() { return b; }
`);

  fs.writeFileSync(path.join(testDir, 'b.js'), `
export const b = 2;
export function double(x) { return x * 2; }
`);

  fs.writeFileSync(path.join(testDir, 'c.js'), `
import { b } from './b';
export const c = b + 1;
`);

  fs.writeFileSync(path.join(testDir, 'circular1.js'), `
import { circular2 } from './circular2';
export const circular1 = 1;
export function getCircular2() { return circular2; }
`);

  fs.writeFileSync(path.join(testDir, 'circular2.js'), `
import { circular1 } from './circular1';
export const circular2 = 2;
export function getCircular1() { return circular1; }
`);

  return testDir;
}

function cleanup(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runTests() {
  console.log('=== Testing ModuleGraph ===');
  let passed = 0;
  let failed = 0;

  const testDir = createTestFiles();

  try {
    const graph = new ModuleGraph();
    graph.addEntry(path.join(testDir, 'a.js'));
    graph.build();

    assert.strictEqual(graph.getAllModules().length, 3, 'Should have 3 modules');
    passed++;
    console.log('✓ Builds correct number of modules');

    const moduleA = graph.getModule(path.join(testDir, 'a.js'));
    const moduleB = graph.getModule(path.join(testDir, 'b.js'));
    const moduleC = graph.getModule(path.join(testDir, 'c.js'));

    assert.ok(moduleA, 'Module A should exist');
    assert.ok(moduleB, 'Module B should exist');
    assert.ok(moduleC, 'Module C should exist');
    passed++;
    console.log('✓ All modules exist in graph');

    assert.ok(moduleA.dependencies.has(moduleB.id), 'A should depend on B');
    assert.ok(moduleA.dependencies.has(moduleC.id), 'A should depend on C');
    passed++;
    console.log('✓ Module dependencies are correct');

    assert.ok(moduleB.dependents.has(moduleA.id), 'B should be depended on by A');
    assert.ok(moduleB.dependents.has(moduleC.id), 'B should be depended on by C');
    passed++;
    console.log('✓ Module dependents are correct');

    assert.ok(moduleC.dependencies.has(moduleB.id), 'C should depend on B');
    passed++;
    console.log('✓ Transitive dependencies are resolved');

    const sorted = graph.topoSort();
    const aIndex = sorted.indexOf(moduleA.id);
    const bIndex = sorted.indexOf(moduleB.id);
    const cIndex = sorted.indexOf(moduleC.id);

    assert.ok(bIndex < aIndex, 'B should come before A in topo sort');
    assert.ok(bIndex < cIndex, 'B should come before C in topo sort');
    passed++;
    console.log('✓ Topological sort respects dependency order');

    const circularGraph = new ModuleGraph();
    circularGraph.addEntry(path.join(testDir, 'circular1.js'));
    circularGraph.build();

    assert.strictEqual(circularGraph.getAllModules().length, 2, 'Circular graph should have 2 modules');
    passed++;
    console.log('✓ Handles circular dependency graph');

    assert.ok(circularGraph.hasCycle(), 'Should detect circular dependency');
    passed++;
    console.log('✓ Detects circular dependencies');

    const cycles = circularGraph.getCycles();
    assert.ok(cycles.length >= 1, 'Should detect at least 1 cycle');
    passed++;
    console.log('✓ Records cycle paths correctly');

    const circularSorted = circularGraph.topoSort();
    assert.strictEqual(circularSorted.length, 2, 'Topo sort with cycles should include all modules');
    passed++;
    console.log('✓ Topological sort handles cycles gracefully');

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
