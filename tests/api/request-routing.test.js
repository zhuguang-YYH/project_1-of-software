const { assert, clearModule, projectPath, test } = require('../helpers/test-utils');

function loadRequestWithWx(resultFactory) {
  const calls = [];
  global.wx = {
    cloud: {
      callFunction: async (payload) => {
        calls.push(payload);
        const result = typeof resultFactory === 'function' ? resultFactory(payload) : resultFactory;
        return { result };
      }
    },
    showToast() {}
  };
  clearModule(projectPath('miniprogram', 'utils', 'request.js'));
  clearModule(projectPath('miniprogram', 'config', 'index.js'));
  return {
    calls,
    requestModule: require(projectPath('miniprogram', 'utils', 'request.js'))
  };
}

test('api: request utility routes module_action function names into action payloads', async () => {
  const { calls, requestModule } = loadRequestWithWx({ code: 0, data: { ok: true } });

  const result = await requestModule.callFunction('activity_register', {
    activity_id: 'act_1',
    action: 'client_value'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, 'activity');
  assert.strictEqual(calls[0].data.action, 'register');
  assert.strictEqual(calls[0].data.business_action, 'client_value');
  assert.strictEqual(calls[0].data.activity_id, 'act_1');
});

test('api: request utility normalizes cloud success and failure response shapes', async () => {
  const { requestModule } = loadRequestWithWx({ code: 0, data: { value: 1 } });

  const success = requestModule.request.normalizeCloudResponse({
    result: { code: 0, data: { value: 1 }, message: 'ok' }
  });
  const failure = requestModule.request.normalizeCloudResponse({
    result: { code: 'BUSINESS_ERROR', message: 'failed' }
  });

  assert.strictEqual(success.success, true);
  assert.strictEqual(success.value, 1);
  assert.strictEqual(failure.success, false);
  assert.strictEqual(failure.error, 'failed');
});

test('api: ActivityService registerActivity carries idempotent client request id', async () => {
  const { calls } = loadRequestWithWx({
    code: 0,
    data: { registration_id: 'reg_1' },
    message: 'ok'
  });
  clearModule(projectPath('miniprogram', 'services', 'activity.js'));
  const activityService = require(projectPath('miniprogram', 'services', 'activity.js'));

  const result = await activityService.registerActivity('act_1', { reason: 'join' });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.registration_id, 'reg_1');
  assert.strictEqual(calls[0].name, 'activity');
  assert.strictEqual(calls[0].data.action, 'register');
  assert.strictEqual(calls[0].data.activity_id, 'act_1');
  assert.ok(calls[0].data.client_request_id);
});

test('api: DudService trims message before cloud call and exposes reply data', async () => {
  const { calls } = loadRequestWithWx({
    code: 0,
    data: {
      reply_content: 'reply',
      matched_keyword: 'help',
      match_type: 'exact',
      rule_id: 'rule_1'
    },
    message: 'ok'
  });
  clearModule(projectPath('miniprogram', 'services', 'dud.js'));
  const dudService = require(projectPath('miniprogram', 'services', 'dud.js'));

  const result = await dudService.chat('  help  ');

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.reply_content, 'reply');
  assert.strictEqual(result.matched_keyword, 'help');
  assert.strictEqual(calls[0].name, 'dud');
  assert.strictEqual(calls[0].data.action, 'chat');
  assert.strictEqual(calls[0].data.message, 'help');
});

test('api: PuzzleService submitAnswer sends idempotent answer request', async () => {
  const { calls } = loadRequestWithWx({
    code: 0,
    data: { is_correct: true, score_gained: 10 },
    message: 'ok'
  });
  clearModule(projectPath('miniprogram', 'services', 'puzzle.js'));
  const puzzleService = require(projectPath('miniprogram', 'services', 'puzzle.js'));

  const result = await puzzleService.submitAnswer('puzzle_1', 'A');

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.is_correct, true);
  assert.strictEqual(calls[0].name, 'puzzle');
  assert.strictEqual(calls[0].data.action, 'submitAnswer');
  assert.strictEqual(calls[0].data.puzzle_id, 'puzzle_1');
  assert.strictEqual(calls[0].data.option_id, 'A');
  assert.ok(calls[0].data.client_request_id);
});

test('api: FeedbackService trims content before submit', async () => {
  const { calls } = loadRequestWithWx({
    code: 0,
    data: { feedback_id: 'feedback_1' },
    message: 'ok'
  });
  clearModule(projectPath('miniprogram', 'services', 'feedback.js'));
  const feedbackService = require(projectPath('miniprogram', 'services', 'feedback.js'));

  const result = await feedbackService.submit({
    content: '  希望增加更多活动  ',
    feedback_type: 'activity',
    is_anonymous: true
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.feedback_id, 'feedback_1');
  assert.strictEqual(calls[0].name, 'feedback');
  assert.strictEqual(calls[0].data.action, 'submit');
  assert.strictEqual(calls[0].data.content, '希望增加更多活动');
  assert.strictEqual(calls[0].data.feedback_type, 'activity');
  assert.strictEqual(calls[0].data.is_anonymous, true);
});

test('api: RecommendationService passes category and keyword filters', async () => {
  const { calls } = loadRequestWithWx({
    code: 0,
    data: { list: [{ recommendation_id: 'rec_1' }], total: 1, has_more: false },
    message: 'ok'
  });
  clearModule(projectPath('miniprogram', 'services', 'recommendation.js'));
  const recommendationService = require(projectPath('miniprogram', 'services', 'recommendation.js'));

  const result = await recommendationService.getRecommendations({
    page: 2,
    page_size: 5,
    category: 'book',
    keyword: '推理'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.total, 1);
  assert.strictEqual(calls[0].name, 'recommendation');
  assert.strictEqual(calls[0].data.action, 'getRecommendations');
  assert.strictEqual(calls[0].data.page, 2);
  assert.strictEqual(calls[0].data.page_size, 5);
  assert.strictEqual(calls[0].data.category, 'book');
  assert.strictEqual(calls[0].data.keyword, '推理');
});
