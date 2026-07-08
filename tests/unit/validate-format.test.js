const { assert, loadFresh, projectPath, test } = require('../helpers/test-utils');

test('unit: validate handles common input rules', () => {
  const validate = loadFresh(projectPath('miniprogram', 'utils', 'validate.js'));

  assert.strictEqual(validate.isEmail('detective@nku.edu.cn'), true);
  assert.strictEqual(validate.isEmail('bad-email'), false);
  assert.strictEqual(validate.isPhone('13800138000'), true);
  assert.strictEqual(validate.isPhone('12800138000'), false);
  assert.strictEqual(validate.isSafeText('<script>alert(1)</script>'), false);
  assert.strictEqual(validate.isValidCapacity(30), true);
  assert.strictEqual(validate.isValidCapacity(10001), false);
});

test('unit: validateObject reports required and custom rule failures', () => {
  const validate = loadFresh(projectPath('miniprogram', 'utils', 'validate.js'));

  const result = validate.validateObject(
    { title: '', reward: -1 },
    {
      title: { required: true, message: 'title required' },
      reward: { validate: validate.isValidPoints.bind(validate), message: 'reward invalid' }
    }
  );

  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errors.title, 'title required');
  assert.strictEqual(result.errors.reward, 'reward invalid');
});

test('unit: format normalizes dates, numbers, sizes and percentages', () => {
  const format = loadFresh(projectPath('miniprogram', 'utils', 'format.js'));

  assert.strictEqual(format.formatDate('2026-07-08T09:05:06', 'YYYY/MM/DD HH:mm'), '2026/07/08 09:05');
  assert.strictEqual(format.formatDate('not-a-date'), '');
  assert.strictEqual(format.formatNumber(1234567), '1,234,567');
  assert.strictEqual(format.formatFileSize(2048), '2.00 KB');
  assert.strictEqual(format.truncateText('abcdef', 3), 'abc...');
  assert.strictEqual(format.escapeHtml('<a>"x"</a>'), '&lt;a&gt;&quot;x&quot;&lt;/a&gt;');
  assert.strictEqual(format.formatPercentage(1, 4, 1), '25.0%');
});
