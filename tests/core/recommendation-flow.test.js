const {
  assert,
  clearModule,
  projectPath,
  test,
  withMockedModule
} = require('../helpers/test-utils');
const { createMockCloud } = require('../helpers/mock-cloud');

function loadRecommendationFunction(mockCloud) {
  const modulePath = projectPath('cloudfunctions', 'recommendation', 'index.js');
  clearModule(modulePath);
  return withMockedModule('wx-server-sdk', mockCloud, () => require(modulePath));
}

test('core: recommendation list filters hidden and offline content', async () => {
  const mockCloud = createMockCloud({
    recommendations: [
      { _id: 'rec_1', title: '推理小说推荐', category: 'book', status: 'published', published_at: '2026-07-08' },
      { _id: 'rec_2', title: '隐藏内容', category: 'book', status: 'hidden', published_at: '2026-07-07' },
      { _id: 'rec_3', title: '下架内容', category: 'book', status: 'offline', published_at: '2026-07-06' }
    ],
    activities: []
  });
  const recommendation = loadRecommendationFunction(mockCloud);

  const result = await recommendation.main({
    action: 'getRecommendations',
    category: 'book',
    page: 1,
    page_size: 10
  });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.total, 1);
  assert.strictEqual(result.data.list[0].recommendation_id, 'rec_1');
});

test('core: recommendation keyword search matches title and reason', async () => {
  const mockCloud = createMockCloud({
    recommendations: [
      { _id: 'rec_1', title: '剧本杀推荐', category: 'game', reason: '适合推理新手', status: 'published', published_at: '2026-07-08' },
      { _id: 'rec_2', title: '桌游推荐', category: 'game', reason: '欢乐聚会', status: 'published', published_at: '2026-07-07' }
    ],
    activities: []
  });
  const recommendation = loadRecommendationFunction(mockCloud);

  const result = await recommendation.main({
    action: 'getRecommendations',
    keyword: '推理',
    page: 1,
    page_size: 10
  });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.total, 1);
  assert.strictEqual(result.data.list[0].recommendation_id, 'rec_1');
});

test('core: recommendation detail returns selected recommendation content', async () => {
  const mockCloud = createMockCloud({
    recommendations: [
      { _id: 'rec_1', title: '推理小说推荐', category: 'book', status: 'published', reason: '经典入门' }
    ],
    activities: []
  });
  const recommendation = loadRecommendationFunction(mockCloud);

  const result = await recommendation.main({ action: 'getDetail', recommendation_id: 'rec_1' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.recommendation_id, 'rec_1');
  assert.strictEqual(result.data.title, '推理小说推荐');
  assert.strictEqual(result.data.reason, '经典入门');
});
