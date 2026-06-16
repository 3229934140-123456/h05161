const testParser = require('./test-parser');
const testModuleGraph = require('./test-module-graph');
const testOptimizer = require('./test-optimizer');
const testCodeSplitter = require('./test-code-splitter');
const testE2E = require('./test-e2e');

async function runAllTests() {
  console.log('========================================');
  console.log('  Mini Bundler - Test Suite');
  console.log('========================================\n');

  let totalPassed = 0;
  let totalFailed = 0;
  const results = [];

  const tests = [
    { name: 'DependencyParser', runner: testParser.runTests },
    { name: 'ModuleGraph', runner: testModuleGraph.runTests },
    { name: 'Optimizer', runner: testOptimizer.runTests },
    { name: 'CodeSplitter', runner: testCodeSplitter.runTests },
    { name: 'End-to-End Build', runner: testE2E.runTests }
  ];

  for (const test of tests) {
    try {
      const result = await test.runner();
      results.push({ name: test.name, ...result });
      totalPassed += result.passed;
      totalFailed += result.failed;
    } catch (e) {
      console.log(`Error running ${test.name} tests: ${e.message}`);
      results.push({ name: test.name, passed: 0, failed: 1, error: e.message });
      totalFailed++;
    }
  }

  console.log('========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log(`Total: ${totalPassed + totalFailed} tests`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log('');

  for (const r of results) {
    const status = r.failed === 0 ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} ${r.name}: ${r.passed} passed, ${r.failed} failed`);
  }

  console.log('');

  if (totalFailed > 0) {
    console.log('Some tests failed!');
    process.exit(1);
  } else {
    console.log('All tests passed! ✓');
    process.exit(0);
  }
}

if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };
