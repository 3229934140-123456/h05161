const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ModuleGraph = require('../src/module-graph');
const CodeSplitter = require('../src/code-splitter');

function createTestFiles() {
  const testDir = path.join(__dirname, 'fixtures', 'splitter');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  fs.writeFileSync(path.join(testDir, 'main.js'), `
import { shared } from './shared';

console.log(shared);

import('./lazy').then(m => console.log(m));
`);

  fs.writeFileSync(path.join(testDir, 'shared.js'), `
export const shared = 'this is shared';
export const sharedFunction = () => 'shared function';
`);

  fs.writeFileSync(path.join(testDir, 'lazy.js'), `
import { shared } from './shared';
export const lazy = 'this is lazy';
export function useShared() { return shared + ' used in lazy'; }
`);

  fs.writeFileSync(path.join(testDir, 'entry2.js'), `
import { shared, sharedFunction } from './shared';
console.log(sharedFunction());
`);

  return testDir;
}

function cleanup(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runTests() {
  console.log('=== Testing CodeSplitter ===');
  let passed = 0;
  let failed = 0;

  const testDir = createTestFiles();

  try {
    const graph = new ModuleGraph();
    graph.addEntry(path.join(testDir, 'main.js'));
    graph.addEntry(path.join(testDir, 'entry2.js'));
    graph.build();

    const splitter = new CodeSplitter({
      moduleGraph: graph,
      splitChunks: true
    });

    splitter.split();

    const chunks = splitter.getChunks();
    assert.ok(chunks.length >= 2, 'Should have at least 2 chunks (main, lazy)');
    passed++;
    console.log('✓ Generates multiple chunks');

    const initialChunks = splitter.getInitialChunks();
    assert.ok(initialChunks.length >= 2, 'Should have initial chunks for entries');
    passed++;
    console.log('✓ Identifies initial chunks correctly');

    const asyncChunks = splitter.getAsyncChunks();
    assert.ok(asyncChunks.length >= 1, 'Should have at least 1 async chunk');
    passed++;
    console.log('✓ Identifies async chunks from dynamic imports');

    const mainChunk = initialChunks.find(c => c.id === 'main');
    assert.ok(mainChunk, 'Should have main chunk');
    passed++;
    console.log('✓ Creates main chunk for entry');

    const mainModule = graph.getModule(path.join(testDir, 'main.js'));
    const sharedModule = graph.getModule(path.join(testDir, 'shared.js'));

    assert.ok(mainChunk.hasModule(mainModule.id), 'Main chunk should contain entry module');
    passed++;
    console.log('✓ Entry modules are in their respective chunks');

    const chunkIds = splitter.getModuleChunkIds(sharedModule.id);
    assert.ok(chunkIds.length >= 1, 'Shared module should be in at least one chunk');
    passed++;
    console.log('✓ Tracks which chunks contain each module');

    const initialAndAsync = chunks.filter(c => c.type === 'initial' || c.type === 'async');
    for (const chunk of initialAndAsync) {
      assert.ok(chunk.entryModule, 'Initial and async chunks should have an entry module');
    }
    passed++;
    console.log('✓ Initial and async chunks have entry modules');

    for (const chunk of chunks) {
      assert.ok(chunk.hash, 'Each chunk should have a content hash');
      assert.strictEqual(chunk.hash.length, 8, 'Hash should be 8 characters');
    }
    passed++;
    console.log('✓ Generates content hashes for chunks');

    const files = splitter.getChunkFiles('main', {
      filename: '[name].js',
      chunkFilename: '[id].[hash].js'
    });
    assert.ok(files.length > 0, 'Should generate output file paths');
    assert.ok(files[0].includes('main'), 'Main chunk filename should include name');
    passed++;
    console.log('✓ Generates correct output filenames');

    const asyncFiles = splitter.getChunkFiles(asyncChunks[0].id, {
      filename: '[name].js',
      chunkFilename: '[id].[hash].js'
    });
    assert.ok(asyncFiles[0].includes(asyncChunks[0].hash), 'Async chunk filename should include hash');
    passed++;
    console.log('✓ Async chunk filenames include content hash');

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
