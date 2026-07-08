const {
  assert,
  clearModule,
  projectPath,
  test,
  withMockedModule
} = require('../helpers/test-utils');
const { createMockCloud } = require('../helpers/mock-cloud');

function loadPuzzleFunction(mockCloud) {
  const modulePath = projectPath('cloudfunctions', 'puzzle', 'index.js');
  clearModule(modulePath);
  return withMockedModule('wx-server-sdk', mockCloud, () => require(modulePath));
}

function todayText() {
  return new Date().toISOString().split('T')[0];
}

function basePuzzleData() {
  const today = todayText();
  return {
    users: [{
      _id: 'user_1',
      openid: 'openid_test',
      total_points: 0,
      available_points: 0,
      frozen_points: 0,
      used_points: 0
    }],
    point_accounts: [],
    points_log: [],
    puzzles: [{
      _id: 'puzzle_1',
      title: '每日谜题',
      content: '谁是凶手？',
      publish_date: today,
      status: 'published',
      reward_points: 10,
      correct_answer: 'A',
      answer_explanation: '线索指向 A',
      options: ['A', 'B', 'C']
    }],
    puzzle_options: [],
    puzzle_answers: []
  };
}

test('core: puzzle getTodayPuzzle returns published puzzle and hides correct answer before answering', async () => {
  const mockCloud = createMockCloud(basePuzzleData());
  const puzzle = loadPuzzleFunction(mockCloud);

  const result = await puzzle.main({ action: 'getTodayPuzzle' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.puzzle_id, 'puzzle_1');
  assert.strictEqual(result.data.answered, false);
  assert.strictEqual(result.data.correct_answer, '');
  assert.strictEqual(result.data.options.length, 3);
});

test('core: puzzle submit correct answer adds points and writes answer record', async () => {
  const mockCloud = createMockCloud(basePuzzleData());
  const puzzle = loadPuzzleFunction(mockCloud);

  const result = await puzzle.main({ action: 'submitAnswer', puzzle_id: 'puzzle_1', option_id: 'A' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.is_correct, true);
  assert.strictEqual(result.data.score_gained, 10);
  assert.strictEqual(mockCloud.__store.puzzle_answers.length, 1);
  assert.strictEqual(mockCloud.__store.users[0].total_points, 10);
  assert.strictEqual(mockCloud.__store.users[0].available_points, 10);
  assert.strictEqual(mockCloud.__store.points_log.length, 1);
});

test('core: puzzle duplicate daily answer is returned idempotently without extra points', async () => {
  const mockCloud = createMockCloud(basePuzzleData());
  const puzzle = loadPuzzleFunction(mockCloud);

  const first = await puzzle.main({ action: 'submitAnswer', puzzle_id: 'puzzle_1', option_id: 'A' });
  const second = await puzzle.main({ action: 'submitAnswer', puzzle_id: 'puzzle_1', option_id: 'A' });

  assert.strictEqual(first.code, 0);
  assert.strictEqual(second.code, 0);
  assert.strictEqual(second.data.idempotent, true);
  assert.strictEqual(mockCloud.__store.puzzle_answers.length, 1);
  assert.strictEqual(mockCloud.__store.users[0].total_points, 10);
  assert.strictEqual(mockCloud.__store.points_log.length, 1);
});
