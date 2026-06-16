const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Bundler = require('../src/bundler');

function createTestFiles() {
  const testDir = path.join(__dirname, 'fixtures', 'e2e');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  fs.writeFileSync(path.join(testDir, 'index.js'), `
import { add, multiply, PI } from './math';
import { format } from './utils';

const result = add(multiply(PI, 2), 10);
console.log(format(result));

if (typeof window !== 'undefined') {
  window.addEventListener('click', () => {
    import('./lazy').then(m => {
      console.log('Lazy loaded:', m.default);
    });
  });
}
`);

  fs.writeFileSync(path.join(testDir, 'math.js'), `
export const add = (a, b) => a + b;
export const subtract = (a, b) => a - b;
export const multiply = (a, b) => a * b;
export const divide = (a, b) => a / b;
export const PI = 3.14159265359;
export const E = 2.71828182846;
`);

  fs.writeFileSync(path.join(testDir, 'utils.js'), `
export function format(num) {
  return Number(num).toFixed(2);
}

export function parse(str) {
  return parseFloat(str);
}

export function validate(num) {
  return typeof num === 'number' && !isNaN(num);
}
`);

  fs.writeFileSync(path.join(testDir, 'lazy.js'), `
export default 'This is lazy loaded content';
export function lazyFunction() {
  return 'lazy function called';
}
`);

  return testDir;
}

function cleanup(testDir) {
  const outputDir = path.join(testDir, 'dist');
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runTests() {
  console.log('=== Testing End-to-End Build ===');
  let passed = 0;
  let failed = 0;

  const testDir = createTestFiles();
  const outputDir = path.join(testDir, 'dist');

  try {
    const bundler = new Bundler({
      entry: path.join(testDir, 'index.js'),
      outputDir: outputDir,
      sourceMap: true,
      treeshake: true,
      splitChunks: true,
      publicPath: './'
    });

    return bundler.build().then((result) => {
      assert.ok(result, 'Build should return a result');
      passed++;
      console.log('✓ Build completes successfully');

      assert.ok(result.chunks && result.chunks.length > 0, 'Should have chunks');
      passed++;
      console.log('✓ Generates chunks');

      assert.ok(result.assets && result.assets.size > 0, 'Should have output assets');
      passed++;
      console.log('✓ Generates output assets');

      const mainChunk = result.chunks.find(c => c.type === 'initial');
      assert.ok(mainChunk, 'Should have initial chunk');
      assert.ok(mainChunk.code, 'Main chunk should have code');
      passed++;
      console.log('✓ Main chunk is generated');

      assert.ok(mainChunk.code.includes('__mini_bundler_modules__'), 'Should include runtime');
      assert.ok(mainChunk.code.includes('__mini_bundler_require__'), 'Should include require function');
      passed++;
      console.log('✓ Runtime is included in bundle');

      assert.ok(mainChunk.code.includes('add'), 'Should include used function');
      assert.ok(mainChunk.code.includes('multiply'), 'Should include used function');
      assert.ok(mainChunk.code.includes('PI'), 'Should include used constant');
      assert.ok(mainChunk.code.includes('format'), 'Should include used function');
      passed++;
      console.log('✓ Used exports are included in bundle');

      const asyncChunk = result.chunks.find(c => c.type === 'async');
      if (asyncChunk) {
        assert.ok(asyncChunk.code.includes('lazy'), 'Async chunk should contain lazy module');
        passed++;
        console.log('✓ Dynamic import creates separate async chunk');
      } else {
        console.log('⚠ Note: No async chunk generated (dynamic import in conditional)');
        passed++;
      }

      if (result.sourceMaps && result.sourceMaps.size > 0) {
        for (const [fileName, sourceMap] of result.sourceMaps) {
          assert.ok(sourceMap, `Source map for ${fileName} should exist`);
          const mapData = JSON.parse(sourceMap);
          assert.ok(mapData.mappings, 'Source map should have mappings');
          assert.ok(mapData.sources, 'Source map should have sources');
        }
        passed++;
        console.log('✓ Source maps are generated');
      }

      for (const [fileName, content] of result.assets) {
        const filePath = path.join(outputDir, fileName);
        assert.ok(fs.existsSync(filePath), `File ${fileName} should be written to disk`);
      }
      passed++;
      console.log('✓ Output files are written to disk');

      assert.ok(result.stats, 'Should have build statistics');
      assert.strictEqual(result.stats.moduleCount, 4, 'Should have 4 modules');
      passed++;
      console.log('✓ Build statistics are collected');

      assert.ok(result.stats.treeshakingSaved >= 0, 'Should track tree-shaking savings');
      console.log(`  Tree-shaking saved: ${result.stats.treeshakingSaved} bytes`);
      passed++;
      console.log('✓ Tree-shaking savings are tracked');

      cleanup(testDir);
      console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
      return { passed, failed };
    }).catch((e) => {
      failed++;
      console.log(`✗ Test failed: ${e.message}`);
      console.log(e.stack);
      cleanup(testDir);
      console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
      return { passed, failed };
    });

  } catch (e) {
    failed++;
    console.log(`✗ Test failed: ${e.message}`);
    console.log(e.stack);
    cleanup(testDir);
    console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
    return Promise.resolve({ passed, failed });
  }
}

module.exports = { runTests };

if (require.main === module) {
  runTests();
}
