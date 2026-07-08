const {
  assert,
  clearModule,
  projectPath,
  test,
  withMockedModule
} = require('../helpers/test-utils');
const { createMockCloud } = require('../helpers/mock-cloud');

function loadActivityFunction(mockCloud) {
  const modulePath = projectPath('cloudfunctions', 'activity', 'index.js');
  clearModule(modulePath);
  return withMockedModule('wx-server-sdk', mockCloud, () => require(modulePath));
}

test('core: activity register creates stable registration and increments count', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test', nickname: 'Tester', student_id: '2310700' }],
    activities: [{
      _id: 'act_1',
      title: '推理夜',
      status: 'recruiting',
      capacity: 2,
      registered_count: 0,
      waitlist_count: 0,
      cancel_deadline: '2099-01-01T00:00:00.000Z',
      start_time: '2099-01-02 19:00',
      location: 'Nankai'
    }],
    activity_registrations: [],
    activity_waitlist: []
  });
  const activity = loadActivityFunction(mockCloud);

  const result = await activity.main({ action: 'register', activity_id: 'act_1', reason: 'join' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.registration_id, 'activity_reg_act_1_user_1');
  assert.strictEqual(mockCloud.__store.activities[0].registered_count, 1);
  assert.strictEqual(mockCloud.__store.activity_registrations.length, 1);
  assert.strictEqual(mockCloud.__store.activity_registrations[0].status, 'registered');
});

test('core: activity register is idempotent for an existing registration', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    activities: [{ _id: 'act_1', status: 'recruiting', capacity: 2, registered_count: 1 }],
    activity_registrations: [{
      _id: 'activity_reg_act_1_user_1',
      registration_id: 'activity_reg_act_1_user_1',
      user_id: 'user_1',
      activity_id: 'act_1',
      status: 'registered'
    }],
    activity_waitlist: []
  });
  const activity = loadActivityFunction(mockCloud);

  const result = await activity.main({ action: 'register', activity_id: 'act_1' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.idempotent, true);
  assert.strictEqual(mockCloud.__store.activities[0].registered_count, 1);
  assert.strictEqual(mockCloud.__store.activity_registrations.length, 1);
});

test('core: full activity places user on waitlist instead of overbooking', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    activities: [{
      _id: 'act_1',
      status: 'recruiting',
      capacity: 1,
      registered_count: 1,
      waitlist_count: 0
    }],
    activity_registrations: [],
    activity_waitlist: []
  });
  const activity = loadActivityFunction(mockCloud);

  const result = await activity.main({ action: 'register', activity_id: 'act_1', reason: 'late' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.data.waitlisted, true);
  assert.strictEqual(mockCloud.__store.activities[0].registered_count, 1);
  assert.strictEqual(mockCloud.__store.activities[0].waitlist_count, 1);
  assert.strictEqual(mockCloud.__store.activity_waitlist[0].status, 'waiting');
});

test('core: activity cancel updates registration and decrements count', async () => {
  const mockCloud = createMockCloud({
    users: [{ _id: 'user_1', openid: 'openid_test' }],
    activities: [{
      _id: 'act_1',
      status: 'recruiting',
      capacity: 3,
      registered_count: 1,
      cancel_deadline: '2099-01-01T00:00:00.000Z'
    }],
    activity_registrations: [{
      _id: 'activity_reg_act_1_user_1',
      registration_id: 'activity_reg_act_1_user_1',
      user_id: 'user_1',
      activity_id: 'act_1',
      status: 'registered'
    }],
    activity_waitlist: []
  });
  const activity = loadActivityFunction(mockCloud);

  const result = await activity.main({ action: 'cancelRegister', activity_id: 'act_1' });

  assert.strictEqual(result.code, 0);
  assert.strictEqual(mockCloud.__store.activity_registrations[0].status, 'cancelled');
  assert.strictEqual(mockCloud.__store.activities[0].registered_count, 0);
});
