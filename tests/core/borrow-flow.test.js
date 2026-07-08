const {
  assert,
  clearModule,
  projectPath,
  test,
  withMockedModule
} = require('../helpers/test-utils');
const { createMockCloud } = require('../helpers/mock-cloud');

function loadBorrowFunction(mockCloud) {
  const modulePath = projectPath('cloudfunctions', 'borrow', 'index.js');
  clearModule(modulePath);
  return withMockedModule('wx-server-sdk', mockCloud, () => require(modulePath));
}

test('core: borrow getItems returns only borrowable inventory with pagination', async () => {
  const mockCloud = createMockCloud({
    inventory_items: [
      { _id: 'book_1', item_name: 'Book A', item_type: 'book', status: 'available', created_at: '2026-07-03' },
      { _id: 'good_1', item_name: 'Gift', item_type: 'exchange_good', status: 'available', created_at: '2026-07-02' },
      { _id: 'old_1', item_name: 'Old', item_type: 'book', status: 'discontinued', created_at: '2026-07-01' },
      { _id: 'script_1', item_name: 'Script A', item_type: 'script', status: 'available', created_at: '2026-07-04' }
    ]
  });
  const borrow = loadBorrowFunction(mockCloud);

  const result = await borrow.main({ action: 'getItems', page: 1, page_size: 10 });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.total, 2);
  assert.deepStrictEqual(result.data.list.map((item) => item.item_id), ['script_1', 'book_1']);
});

test('core: borrow applyBorrow creates application and locks available item', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test', nickname: 'Tester' }],
    inventory_items: [
      { _id: 'book_1', item_name: 'Book A', item_type: 'book', status: 'available', borrow_count: 0 }
    ],
    borrow_applications: [],
    borrow_records: []
  });
  const borrow = loadBorrowFunction(mockCloud);

  const result = await borrow.main({
    action: 'applyBorrow',
    item_id: 'book_1',
    reason: 'read',
    expected_return_date: '2026-07-20'
  });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(mockCloud.__store.borrow_applications.length, 1);
  assert.strictEqual(mockCloud.__store.borrow_records.length, 1);
  assert.strictEqual(mockCloud.__store.inventory_items[0].status, 'in_transit');
  assert.strictEqual(mockCloud.__store.inventory_items[0].current_borrower_id, 'user_1');
  assert.strictEqual(mockCloud.__store.inventory_items[0].borrow_count, 1);
});

test('core: borrow applyBorrow rejects unavailable item without creating records', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test', nickname: 'Tester' }],
    inventory_items: [
      { _id: 'book_1', item_name: 'Book A', item_type: 'book', status: 'borrowed', borrow_count: 2 }
    ],
    borrow_applications: [],
    borrow_records: []
  });
  const borrow = loadBorrowFunction(mockCloud);

  const result = await borrow.main({ action: 'applyBorrow', item_id: 'book_1' });

  assert.notStrictEqual(result.code, 0);
  assert.strictEqual(mockCloud.__store.borrow_applications.length, 0);
  assert.strictEqual(mockCloud.__store.inventory_items[0].status, 'borrowed');
  assert.strictEqual(mockCloud.__store.inventory_items[0].borrow_count, 2);
});
