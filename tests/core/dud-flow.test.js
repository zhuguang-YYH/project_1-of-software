const {
  assert,
  clearModule,
  projectPath,
  test,
  withMockedModule
} = require('../helpers/test-utils');
const { createMockCloud } = require('../helpers/mock-cloud');

function loadDudFunction(mockCloud) {
  const modulePath = projectPath('cloudfunctions', 'dud', 'index.js');
  clearModule(modulePath);
  return withMockedModule('wx-server-sdk', mockCloud, () => require(modulePath));
}

test('core: dud chat matches enabled keyword rule and stores both messages', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    dud_keywords: [{
      _id: 'rule_1',
      keyword: '积分',
      keywords: ['积分'],
      match_type: 'exact',
      reply_content: '积分可通过每日谜题和活动获得',
      priority: 10,
      is_enabled: true,
      match_count: 0
    }],
    dud_messages: []
  });
  const dud = loadDudFunction(mockCloud);

  const result = await dud.main({ action: 'chat', message: '积分' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.reply_content, '积分可通过每日谜题和活动获得');
  assert.strictEqual(result.data.rule_id, 'rule_1');
  assert.strictEqual(mockCloud.__store.dud_keywords[0].match_count, 1);
  assert.strictEqual(mockCloud.__store.dud_messages.length, 2);
  assert.strictEqual(mockCloud.__store.dud_messages[1].matched_rule_id, 'rule_1');
});

test('core: dud chat falls back when no keyword matches', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    dud_keywords: [{
      _id: 'rule_1',
      keyword: '积分',
      keywords: ['积分'],
      match_type: 'exact',
      reply_content: '积分说明',
      priority: 1,
      is_enabled: true,
      match_count: 0
    }],
    dud_messages: []
  });
  const dud = loadDudFunction(mockCloud);

  const result = await dud.main({ action: 'chat', message: '未知问题' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.match_type, 'fallback');
  assert.strictEqual(result.data.rule_id, '');
  assert.strictEqual(mockCloud.__store.dud_keywords[0].match_count, 0);
  assert.strictEqual(mockCloud.__store.dud_messages.length, 2);
});

test('core: dud chat rejects empty message without writing chat logs', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    dud_keywords: [],
    dud_messages: []
  });
  const dud = loadDudFunction(mockCloud);

  const result = await dud.main({ action: 'chat', message: '   ' });

  assert.notStrictEqual(result.code, 0);
  assert.strictEqual(mockCloud.__store.dud_messages.length, 0);
});
