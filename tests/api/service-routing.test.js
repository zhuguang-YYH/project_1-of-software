const { assert, clearModule, projectPath, test } = require('../helpers/test-utils');

function setupWxMock(result) {
  const calls = [];
  global.wx = {
    cloud: {
      callFunction: async (payload) => {
        calls.push(payload);
        return { result };
      }
    },
    showToast() {}
  };
  return calls;
}

function clearRequestAndService(serviceFile) {
  clearModule(projectPath('miniprogram', 'utils', 'request.js'));
  clearModule(projectPath('miniprogram', 'config', 'index.js'));
  clearModule(projectPath('miniprogram', 'services', serviceFile));
}

test('api: BorrowService routes applyBorrow to borrow cloud function action', async () => {
  const calls = setupWxMock({
    code: 0,
    data: { application_id: 'app_1', borrow_id: 'app_1' },
    message: 'ok'
  });
  clearRequestAndService('borrow.js');
  const borrowService = require(projectPath('miniprogram', 'services', 'borrow.js'));

  const result = await borrowService.applyBorrow('item_1', {
    reason: 'course project',
    expected_return_date: '2026-07-20'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.application_id, 'app_1');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, 'borrow');
  assert.strictEqual(calls[0].data.action, 'applyBorrow');
  assert.strictEqual(calls[0].data.item_id, 'item_1');
  assert.strictEqual(calls[0].data.reason, 'course project');
});

test('api: ExchangeService sends idempotent exchange request', async () => {
  const calls = setupWxMock({
    code: 0,
    data: { exchange_id: 'exchange_1', pickup_code: '000001' },
    message: 'ok'
  });
  clearRequestAndService('exchange.js');
  const exchangeService = require(projectPath('miniprogram', 'services', 'exchange.js'));

  const result = await exchangeService.exchange('good_1', 2);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.exchange_id, 'exchange_1');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, 'exchange');
  assert.strictEqual(calls[0].data.action, 'exchange');
  assert.strictEqual(calls[0].data.item_id, 'good_1');
  assert.strictEqual(calls[0].data.quantity, 2);
  assert.ok(calls[0].data.client_request_id);
});
