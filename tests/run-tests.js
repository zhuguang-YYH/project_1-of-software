const path = require('path');
const { run } = require('./helpers/test-utils');

const testFiles = [
  'unit/validate-format.test.js',
  'api/service-routing.test.js',
  'api/request-routing.test.js',
  'core/puzzle-flow.test.js',
  'core/borrow-flow.test.js',
  'core/exchange-flow.test.js',
  'core/activity-flow.test.js',
  'core/dud-flow.test.js',
  'core/feedback-flow.test.js',
  'core/recommendation-flow.test.js'
];

for (const file of testFiles) {
  require(path.resolve(__dirname, file));
}

(async () => {
  const results = await run();
  const passed = results.filter((item) => item.status === 'passed').length;
  const failed = results.length - passed;

  results.forEach((item) => {
    const mark = item.status === 'passed' ? 'PASS' : 'FAIL';
    console.log(`${mark} ${item.name} (${item.duration}ms)`);
    if (item.error) {
      console.log(`  ${item.error.stack || item.error.message}`);
    }
  });

  console.log('');
  console.log(`Test Suites: ${failed ? 'failed' : 'passed'}`);
  console.log(`Tests: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) process.exitCode = 1;
})();
