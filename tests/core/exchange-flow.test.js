const {
  assert,
  clearModule,
  projectPath,
  test,
  withMockedModule
} = require('../helpers/test-utils');
const { createMockCloud } = require('../helpers/mock-cloud');

function loadExchangeFunction(mockCloud) {
  const modulePath = projectPath('cloudfunctions', 'exchange', 'index.js');
  clearModule(modulePath);
  return withMockedModule('wx-server-sdk', mockCloud, () => require(modulePath));
}

test('core: exchange freezes points, decreases stock and writes pending record', async () => {
  const mockCloud = createMockCloud({
    users: [{
      _id: 'user_1',
      openid: 'openid_test',
      total_points: 100,
      available_points: 80,
      frozen_points: 0,
      used_points: 20
    }],
    point_accounts: [],
    inventory_items: [{
      _id: 'good_1',
      item_name: 'Badge',
      item_type: 'exchange_good',
      status: 'available',
      exchange_points: 30,
      available_quantity: 5,
      exchanged_count: 0
    }],
    exchange_records: []
  });
  const exchange = loadExchangeFunction(mockCloud);

  const result = await exchange.main({
    action: 'exchange',
    item_id: 'good_1',
    quantity: 2,
    client_request_id: 'req-1'
  });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.points_cost, 60);
  assert.strictEqual(mockCloud.__store.inventory_items[0].available_quantity, 3);
  assert.strictEqual(mockCloud.__store.inventory_items[0].exchanged_count, 2);
  assert.strictEqual(mockCloud.__store.users[0].available_points, 20);
  assert.strictEqual(mockCloud.__store.users[0].frozen_points, 60);
  assert.strictEqual(mockCloud.__store.exchange_records.length, 1);
  assert.strictEqual(mockCloud.__store.exchange_records[0].status, 'pending');
});

test('core: exchange rejects insufficient points and rolls stock back', async () => {
  const mockCloud = createMockCloud({
    users: [{
      _id: 'user_1',
      openid: 'openid_test',
      total_points: 30,
      available_points: 20,
      frozen_points: 0,
      used_points: 10
    }],
    point_accounts: [],
    inventory_items: [{
      _id: 'good_1',
      item_name: 'Badge',
      item_type: 'exchange_good',
      status: 'available',
      exchange_points: 30,
      available_quantity: 5,
      exchanged_count: 0
    }],
    exchange_records: []
  });
  const exchange = loadExchangeFunction(mockCloud);

  const result = await exchange.main({
    action: 'exchange',
    item_id: 'good_1',
    quantity: 1,
    client_request_id: 'req-2'
  });

  assert.notStrictEqual(result.code, 0);
  assert.strictEqual(mockCloud.__store.inventory_items[0].available_quantity, 5);
  assert.strictEqual(mockCloud.__store.inventory_items[0].exchanged_count, 0);
  assert.strictEqual(mockCloud.__store.users[0].available_points, 20);
  assert.strictEqual(mockCloud.__store.users[0].frozen_points, 0);
  assert.strictEqual(mockCloud.__store.exchange_records[0].status, 'failed');
});
