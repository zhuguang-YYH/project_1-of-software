const {
  assert,
  clearModule,
  projectPath,
  test,
  withMockedModule
} = require('../helpers/test-utils');
const { createMockCloud } = require('../helpers/mock-cloud');

function loadFeedbackFunction(mockCloud) {
  const modulePath = projectPath('cloudfunctions', 'feedback', 'index.js');
  clearModule(modulePath);
  return withMockedModule('wx-server-sdk', mockCloud, () => require(modulePath));
}

test('core: feedback submit creates pending feedback for current user', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    feedback: []
  });
  const feedback = loadFeedbackFunction(mockCloud);

  const result = await feedback.main({
    action: 'submit',
    content: '希望增加更多线下活动',
    feedback_type: 'activity',
    is_anonymous: true
  });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(mockCloud.__store.feedback.length, 1);
  assert.strictEqual(mockCloud.__store.feedback[0].user_id, 'user_1');
  assert.strictEqual(mockCloud.__store.feedback[0].status, 'pending');
  assert.strictEqual(mockCloud.__store.feedback[0].is_anonymous, true);
});

test('core: feedback submit rejects too short content', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    feedback: []
  });
  const feedback = loadFeedbackFunction(mockCloud);

  const result = await feedback.main({ action: 'submit', content: '太短' });

  assert.notStrictEqual(result.code, 0);
  assert.strictEqual(mockCloud.__store.feedback.length, 0);
});

test('core: feedback getMyFeedback returns only current user feedback', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    feedback: [
      { _id: 'fb_1', user_id: 'user_1', content: '我的反馈', created_at: '2026-07-08T02:00:00Z' },
      { _id: 'fb_2', user_id: 'user_2', content: '其他人反馈', created_at: '2026-07-08T01:00:00Z' }
    ]
  });
  const feedback = loadFeedbackFunction(mockCloud);

  const result = await feedback.main({ action: 'getMyFeedback', page: 1, page_size: 10 });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.total, 1);
  assert.strictEqual(result.data.list[0].feedback_id, 'fb_1');
});
