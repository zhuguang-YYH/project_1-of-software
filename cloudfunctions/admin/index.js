const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// Configure this with the template ID created in the WeChat public platform.
const BORROW_STATUS_CHANGE_TMPL = process.env.BORROW_STATUS_CHANGE_TMPL || '';

const DEFAULT_SYSTEM_SETTINGS = {
  puzzle_publish_time: '09:00',
  default_puzzle_reward: 10,
  activity_cancel_hours: 24,
  recommendation_enabled: true,
  commission_enabled: true
};

const ACTIVITY_ATTEND_POINTS = Math.max(0, Number(process.env.ACTIVITY_ATTEND_POINTS) || 10);

const EXCHANGE_GOOD_TAG_TEXT = {
  new: '新品',
  limited: '限量',
  limited_time: '限时'
};

function normalizeExchangeGoodTag(value) {
  const tag_type = String(value || '').trim();
  return EXCHANGE_GOOD_TAG_TEXT[tag_type] ? tag_type : '';
}

function ok(data = null, message = '操作成功') {
  return { code: 0, data, message };
}

function fail(message, code = -1) {
  return { code, message };
}

function isCollectionMissing(error) {
  return error && (
    error.errCode === -502005 ||
    String(error.message || '').includes('not exist') ||
    String(error.message || '').includes('collection not exists')
  );
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toDateText(value) {
  return value || '';
}

function parseDateBoundary(value, endOfDay = false) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`);
}

function addDateRange(where = {}, field, event = {}) {
  const start = parseDateBoundary(event.start_date, false);
  const end = parseDateBoundary(event.end_date, true);
  const next = { ...(where || {}) };
  const conditions = [];
  if (start) conditions.push(_.gte(start));
  if (end) conditions.push(_.lte(end));
  if (conditions.length === 1) next[field] = conditions[0];
  if (conditions.length > 1) next[field] = conditions[0].and(conditions[1]);
  return next;
}

function buildStatusDateWhere(event, activeStatuses, dateField) {
  const status = String(event.status || 'active').trim();
  const where = {};
  if (status !== 'all') {
    where.status = _.in(status === 'active' ? activeStatuses : [status]);
  }
  return addDateRange(where, dateField, event);
}

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.$date) return new Date(value.$date);
  if (typeof value === 'object' && value.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toBeijingDay(value) {
  const date = toJsDate(value);
  if (!date) return '';
  const cst = new Date(date.getTime() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${cst.getUTCFullYear()}-${p(cst.getUTCMonth() + 1)}-${p(cst.getUTCDate())}`;
}

function buildRecentDays(days = 7) {
  const result = [];
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  now.setUTCHours(0, 0, 0, 0);
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now.getTime() - index * 24 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    result.push(`${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`);
  }
  return result;
}

function countByDay(list, field, days) {
  const map = days.reduce((acc, day) => {
    acc[day] = 0;
    return acc;
  }, {});
  (list || []).forEach(item => {
    const day = toBeijingDay(item[field]);
    if (day && map[day] !== undefined) map[day] += 1;
  });
  return map;
}

function asThing(value, max = 20) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : '—';
}

function nowCstText() {
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${cst.getUTCFullYear()}-${p(cst.getUTCMonth() + 1)}-${p(cst.getUTCDate())} ${p(cst.getUTCHours())}:${p(cst.getUTCMinutes())}:${p(cst.getUTCSeconds())}`;
}

async function sendSubscribeMessage(touser, templateId, data, page) {
  if (!touser || !templateId) return false;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId,
      page: page || 'pages/index/index',
      miniprogramState: 'formal',
      lang: 'zh_CN',
      data
    });
    return true;
  } catch (error) {
    console.warn('[subscribe] send failed:', templateId, error && (error.errCode || error.errMsg || error.message));
    return false;
  }
}

async function safeList(collection, options = {}) {
  try {
    let ref = db.collection(collection);
    if (options.where) ref = ref.where(options.where);
    if (options.orderBy) ref = ref.orderBy(options.orderBy.field, options.orderBy.direction);
    if (options.skip) ref = ref.skip(options.skip);
    if (options.limit) ref = ref.limit(options.limit);
    const res = await ref.get();
    return res.data || [];
  } catch (error) {
    if (isCollectionMissing(error)) return [];
    throw error;
  }
}

async function safeCount(collection, where = null) {
  try {
    const ref = where ? db.collection(collection).where(where) : db.collection(collection);
    const res = await ref.count();
    return res.total || 0;
  } catch (error) {
    if (isCollectionMissing(error)) return 0;
    throw error;
  }
}

async function getDoc(collection, id) {
  if (!id) return null;
  try {
    const res = await db.collection(collection).doc(id).get();
    return res.data || null;
  } catch (error) {
    return null;
  }
}

async function getDocByIdOrField(collection, id, field) {
  const direct = await getDoc(collection, id);
  if (direct) return { ...direct, _doc_id: direct._id || id };

  const list = await safeList(collection, { where: { [field]: id }, limit: 1 });
  if (list.length === 0) return null;
  return { ...list[0], _doc_id: list[0]._id };
}

async function getCurrentUser(openid) {
  const res = await safeList('users', { where: { openid }, limit: 1 });
  return res[0] || null;
}

async function getUserById(user_id) {
  return getDoc('users', user_id);
}

async function ensureAdmin(openid) {
  if (!openid) return { allowed: false, message: '缺少登录态' };
  const user = await getCurrentUser(openid);
  if (!user) return { allowed: false, message: '用户不存在，请先登录' };
  if (user.role === 'admin') return { allowed: true, user };

  // 引导首位管理员：仅当 openid 与环境变量 BOOTSTRAP_ADMIN_OPENID 完全匹配时才允许提权。
  // 在云开发控制台 -> 云函数 -> admin -> 配置 中设置该环境变量。
  const bootstrap = String(process.env.BOOTSTRAP_ADMIN_OPENID || '').trim();
  if (bootstrap && bootstrap === openid) {
    const admin_list = await safeList('users', { where: { role: 'admin' }, limit: 1 });
    if (admin_list.length === 0) {
      await db.collection('users').doc(user._id).update({
        data: { role: 'admin', updated_at: db.serverDate() }
      });
      return { allowed: true, user: { ...user, role: 'admin' } };
    }
  }

  return { allowed: false, message: '仅管理员可访问后台' };
}

async function withAdmin(event, handler) {
  const wx_context = cloud.getWXContext();
  const check = await ensureAdmin(wx_context.OPENID);
  if (!check.allowed) return fail(check.message, 'PERMISSION_DENIED');
  return handler(event, check.user, wx_context);
}

async function logOperation(admin_user, operation_type, target_collection, target_id, after_data, before_data = null) {
  try {
    const data = {
      admin_id: admin_user._id,
      operation_type,
      target_collection,
      target_id: target_id || '',
      before_data,
      after_data: after_data || null,
      created_at: db.serverDate()
    };
    const res = await db.collection('admin_logs').add({ data });
    await db.collection('admin_logs').doc(res._id).update({ data: { log_id: res._id } });
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
}

function normalizeLog(item = {}) {
  const id = item.log_id || item._id || '';
  return {
    log_id: id,
    admin_id: item.admin_id || '',
    operation_type: item.operation_type || '',
    target_collection: item.target_collection || '',
    target_id: item.target_id || '',
    before_data: item.before_data || null,
    after_data: item.after_data || null,
    created_at: item.created_at || ''
  };
}

function makeInventoryItem(data = {}) {
  const total_quantity = toNumber(data.total_quantity, 1);
  const available_quantity = data.available_quantity === undefined
    ? total_quantity
    : toNumber(data.available_quantity, total_quantity);

  return {
    item_name: String(data.item_name || '').trim(),
    item_type: String(data.item_type || 'book').trim(),
    description: String(data.description || '').trim(),
    category: String(data.category || '').trim(),
    campus: String(data.campus || '').trim(),
    location: String(data.location || '').trim(),
    total_quantity,
    available_quantity,
    status: data.status || 'available',
    exchange_points: toNumber(data.exchange_points, 0),
    original_cost: toNumber(data.original_cost, 0),
    cover_url: String(data.cover_url || '').trim(),
    tag_type: normalizeExchangeGoodTag(data.tag_type),
    tag_text: String(data.tag_text || '').trim(),
    stock_warning_threshold: Math.max(0, toNumber(data.stock_warning_threshold, 3)),
    borrow_count: toNumber(data.borrow_count, 0),
    exchanged_count: toNumber(data.exchanged_count, 0),
    genre: String(data.genre || '').trim(),
    min_players: toNumber(data.min_players, 0),
    max_players: toNumber(data.max_players, 0),
    player_range: String(data.player_range || '').trim(),
    duration_minutes: toNumber(data.duration_minutes, 0),
    difficulty: String(data.difficulty || '').trim(),
    created_at: data.created_at || db.serverDate(),
    updated_at: db.serverDate()
  };
}

function readPoints(user = {}, account = {}) {
  return {
    total_points: toNumber(account.total_points || user.total_points, 0),
    available_points: toNumber(account.available_points || user.available_points, 0),
    frozen_points: toNumber(account.frozen_points || user.frozen_points, 0),
    used_points: toNumber(account.used_points || user.used_points, 0)
  };
}

async function ensurePointAccount(user) {
  const list = await safeList('point_accounts', { where: { user_id: user._id }, limit: 1 });
  if (list.length > 0) return list[0];

  const points = readPoints(user);
  const data = {
    user_id: user._id,
    ...points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const res = await db.collection('point_accounts').add({ data });
  return { _id: res._id, ...data };
}

async function syncPoints(user, next_points) {
  const account = await ensurePointAccount(user);
  const data = {
    total_points: toNumber(next_points.total_points, 0),
    available_points: toNumber(next_points.available_points, 0),
    frozen_points: toNumber(next_points.frozen_points, 0),
    used_points: toNumber(next_points.used_points, 0),
    updated_at: db.serverDate()
  };
  await db.collection('users').doc(user._id).update({ data });
  await db.collection('point_accounts').doc(account._id).update({ data });
}

async function addPointsLog(data) {
  try {
    await db.collection('points_log').add({
      data: {
        user_id: data.user_id || '',
        amount: data.amount,
        change_amount: data.change_amount || data.amount,
        type: data.type,
        point_type: data.point_type || 'available',
        business_type: data.business_type || '',
        reason: data.reason || '',
        related_id: data.related_id || '',
        created_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
}

async function syncPuzzleOptions(puzzle_id, option_list, correct_answer) {
  const existed = await safeList('puzzle_options', { where: { puzzle_id }, limit: 100 });
  await Promise.all(existed.map(item => db.collection('puzzle_options').doc(item._id).remove()));
  await Promise.all(option_list.map((option_content, index) => {
    const option_label = String.fromCharCode(65 + index);
    return db.collection('puzzle_options').add({
      data: {
        puzzle_id,
        option_label,
        option_content,
        is_correct: option_label === correct_answer || option_content === correct_answer,
        sort_order: index,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
  }));
}

async function updateBorrowRecordMirror(application_id, data) {
  const list = await safeList('borrow_records', { where: { application_id }, limit: 1 });
  if (list.length > 0) {
    await db.collection('borrow_records').doc(list[0]._id).update({ data });
  }
}

async function updateInventoryItem(item_id, data) {
  if (!item_id) return;
  await db.collection('inventory_items').doc(item_id).update({
    data: {
      ...data,
      updated_at: db.serverDate()
    }
  });
}

async function admin_getDashboard() {
  const trend = await buildDashboardTrend();
  const [
    user_count,
    puzzle_count,
    activity_count,
    inventory_count,
    feedback_pending,
    borrow_active,
    exchange_pending,
    registration_count,
    exchange_count
  ] = await Promise.all([
    safeCount('users'),
    safeCount('puzzles'),
    safeCount('activities'),
    safeCount('inventory_items'),
    safeCount('feedback', { status: _.neq('resolved') }),
    safeCount('borrow_applications', { status: _.in(['applying', 'confirmed', 'in_transit', 'borrowed']) }),
    safeCount('exchange_records', { status: _.in(['pending', 'shipped']) }),
    safeCount('activity_registrations'),
    safeCount('exchange_records')
  ]);

  return ok({
    user_count,
    puzzle_count,
    activity_count,
    inventory_count,
    feedback_pending,
    borrow_active,
    exchange_pending,
    registration_count,
    exchange_count,
    trend
  });
}

async function buildDashboardTrend() {
  const days = buildRecentDays(7);
  const startDate = parseDateBoundary(days[0], false);
  const dateWhere = { created_at: _.gte(startDate) };
  const registrationDateWhere = { registered_at: _.gte(startDate) };
  const [registrations, exchanges, borrows, feedbacks, users] = await Promise.all([
    safeList('activity_registrations', { where: registrationDateWhere, limit: 1000 }),
    safeList('exchange_records', { where: dateWhere, limit: 1000 }),
    safeList('borrow_applications', { where: dateWhere, limit: 1000 }),
    safeList('feedback', { where: dateWhere, limit: 1000 }),
    safeList('users', { where: dateWhere, limit: 1000 })
  ]);
  const registrationMap = countByDay(registrations, 'registered_at', days);
  const exchangeMap = countByDay(exchanges, 'created_at', days);
  const activeMap = days.reduce((acc, day) => {
    acc[day] = new Set();
    return acc;
  }, {});

  [
    ...registrations.map(item => ({ day: toBeijingDay(item.registered_at || item.created_at), user_id: item.user_id })),
    ...exchanges.map(item => ({ day: toBeijingDay(item.created_at), user_id: item.user_id })),
    ...borrows.map(item => ({ day: toBeijingDay(item.created_at), user_id: item.borrower_id || item.user_id })),
    ...feedbacks.map(item => ({ day: toBeijingDay(item.created_at), user_id: item.user_id })),
    ...users.map(item => ({ day: toBeijingDay(item.created_at), user_id: item._id }))
  ].forEach(item => {
    if (item.day && activeMap[item.day] && item.user_id) activeMap[item.day].add(item.user_id);
  });

  const points = days.map(day => ({
    date: day,
    label: day.slice(5),
    registrations: registrationMap[day] || 0,
    exchanges: exchangeMap[day] || 0,
    active_users: activeMap[day] ? activeMap[day].size : 0
  }));
  const max = points.reduce((value, item) => Math.max(value, item.registrations, item.exchanges, item.active_users), 1);
  return { days, max, points };
}

async function admin_savePuzzle(event, admin_user) {
  const option_list = String(event.options_text || '')
    .split(/\n/)
    .map(item => item.trim())
    .filter(Boolean);
  const content = String(event.content || '').trim();
  const publish_date = String(event.publish_date || '').trim();
  const correct_answer = String(event.correct_answer || '').trim();
  const reward_points = toNumber(event.reward_points, DEFAULT_SYSTEM_SETTINGS.default_puzzle_reward);

  if (!publish_date) return fail('谜题日期不能为空');
  if (!content) return fail('谜题内容不能为空');
  if (option_list.length < 2) return fail('至少需要两个选项');
  if (!correct_answer) return fail('正确答案不能为空');

  const data = {
    title: content.slice(0, 20),
    content,
    difficulty: String(event.difficulty || 'easy').trim(),
    reward_points,
    answer_explanation: String(event.answer_explanation || '').trim(),
    publish_date,
    status: 'published',
    created_by: admin_user._id,
    updated_at: db.serverDate()
  };
  const existed = await safeList('puzzles', { where: { publish_date }, limit: 1 });
  let puzzle_id = '';

  if (existed.length > 0) {
    puzzle_id = existed[0]._id;
    await db.collection('puzzles').doc(puzzle_id).update({ data });
  } else {
    const res = await db.collection('puzzles').add({
      data: {
        ...data,
        created_at: db.serverDate()
      }
    });
    puzzle_id = res._id;
  }

  await syncPuzzleOptions(puzzle_id, option_list, correct_answer);
  await logOperation(admin_user, 'save_puzzle', 'puzzles', puzzle_id, data);
  return ok({ puzzle_id }, '谜题已保存');
}

async function admin_createActivity(event, admin_user) {
  const title = String(event.title || '').trim();
  const capacity = toNumber(event.capacity, 0);
  if (!title) return fail('活动标题不能为空');
  if (!Number.isInteger(capacity) || capacity <= 0) return fail('人数上限必须为正整数');

  const data = {
    title,
    description: String(event.description || '').trim(),
    location: String(event.location || '').trim(),
    capacity,
    registered_count: 0,
    waitlist_count: 0,
    cancel_deadline: toDateText(event.cancel_deadline),
    start_time: toDateText(event.start_time),
    end_time: toDateText(event.end_time),
    cover_url: String(event.cover_url || '').trim(),
    image: String(event.cover_url || event.image || '').trim(),
    status: 'recruiting',
    created_by: admin_user._id,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const res = await db.collection('activities').add({ data });
  await logOperation(admin_user, 'create_activity', 'activities', res._id, data);
  return ok({ activity_id: res._id }, '活动已创建');
}

function parseWallClockTs(text) {
  return Date.parse(String(text || '').replace(/\//g, '-'));
}

function beijingNowTs() {
  return Date.now() + 8 * 3600 * 1000;
}

function normalizeActivityRegistration(item = {}, activity = null, user = null) {
  const registration_id = item.registration_id || item._id || '';
  return {
    registration_id,
    activity_id: item.activity_id || '',
    user_id: item.user_id || '',
    user_name: (user && user.nickname) || item.user_name || '未知用户',
    activity_title: (activity && activity.title) || item.activity_title || '活动',
    activity_end_time: activity && activity.end_time,
    reason: item.reason || '',
    status: item.status || 'registered',
    from_waitlist: !!item.from_waitlist,
    registered_at: item.registered_at || item.created_at || '',
    attended_at: item.attended_at || '',
    attend_points: toNumber(item.attend_points, 0),
    updated_at: item.updated_at || ''
  };
}

async function admin_getActivityRegistrations(event) {
  const page = toNumber(event.page, 1);
  const page_size = toNumber(event.page_size, 50);
  const activeStatuses = ['registered', 'confirmed', 'pending', 'attended'];
  const where = event.status === 'all'
    ? null
    : { status: _.in((event.status || 'active') === 'active' ? activeStatuses : [event.status]) };
  const list = await safeList('activity_registrations', {
    where,
    orderBy: { field: 'registered_at', direction: 'desc' },
    skip: (page - 1) * page_size,
    limit: page_size
  });

  const result = await Promise.all(list.map(async (item) => {
    const [activity, user] = await Promise.all([
      getDoc('activities', item.activity_id || ''),
      getUserById(item.user_id || '')
    ]);
    return normalizeActivityRegistration(item, activity, user);
  }));

  let waitlist = [];
  try {
    const waits = await safeList('activity_waitlist', {
      where: { status: 'waiting' },
      orderBy: { field: 'joined_at', direction: 'asc' },
      limit: 50
    });
    waitlist = await Promise.all(waits.map(async (item) => {
      const [activity, user] = await Promise.all([
        getDoc('activities', item.activity_id || ''),
        getUserById(item.user_id || '')
      ]);
      return {
        waitlist_id: item.waitlist_id || item._id,
        activity_id: item.activity_id || '',
        user_id: item.user_id || '',
        user_name: (user && user.nickname) || '未知用户',
        activity_title: (activity && activity.title) || '活动',
        reason: item.reason || '',
        joined_at: item.joined_at || ''
      };
    }));
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }

  return ok({ list: result, waitlist, page, page_size });
}

async function admin_confirmActivityAttendance(event, admin_user) {
  const registration_id = event.registration_id;
  const points = Math.max(0, toNumber(event.points, ACTIVITY_ATTEND_POINTS));
  if (!registration_id) return fail('报名记录编号不能为空');

  const registration = await getDocByIdOrField('activity_registrations', registration_id, 'registration_id');
  if (!registration) return fail('报名记录不存在');
  if (registration.status === 'attended') return ok(null, '已确认参加');
  if (['cancelled', 'failed'].includes(registration.status)) return fail('该报名已取消，不能确认参加');

  const user = await getUserById(registration.user_id || '');
  if (!user) return fail('用户不存在');
  const activity = await getDoc('activities', registration.activity_id || '');
  const endTs = activity && activity.end_time ? parseWallClockTs(activity.end_time) : NaN;
  if (!Number.isNaN(endTs) && endTs > beijingNowTs()) {
    return fail('活动结束后才能确认参加');
  }

  await db.collection('activity_registrations').doc(registration._doc_id).update({
    data: {
      status: 'attended',
      attended_at: db.serverDate(),
      attend_points: points,
      attended_by: admin_user._id,
      updated_at: db.serverDate()
    }
  });

  if (points > 0) {
    const current = readPoints(user, await ensurePointAccount(user));
    await syncPoints(user, {
      ...current,
      total_points: current.total_points + points,
      available_points: current.available_points + points
    });
    await addPointsLog({
      user_id: user._id,
      amount: points,
      type: 'income',
      business_type: 'activity_attendance',
      reason: `活动参与奖励 - ${registration.activity_title || registration.activity_id || ''}`,
      related_id: registration.activity_id || registration_id
    });
  }

  await logOperation(admin_user, 'confirm_activity_attendance', 'activity_registrations', registration_id, { points });
  return ok(null, points > 0 ? `已确认参加，发放 ${points} 积分` : '已确认参加');
}

async function admin_createBorrowItem(event, admin_user) {
  const item_name = String(event.item_name || '').trim();
  const total_quantity = toNumber(event.total_quantity, 1);
  const min_players = toNumber(event.min_players, 0);
  const max_players = toNumber(event.max_players, 0);

  if (!item_name) return fail('物资名称不能为空');
  if (!Number.isInteger(total_quantity) || total_quantity <= 0) return fail('数量必须为正整数');
  if (min_players && max_players && min_players > max_players) return fail('最少人数不能大于最多人数');

  const data = makeInventoryItem({
    item_name,
    description: event.description,
    category: event.category,
    item_type: event.item_type || 'book',
    total_quantity,
    available_quantity: total_quantity,
    genre: event.genre,
    min_players,
    max_players,
    player_range: min_players && max_players ? `${min_players}-${max_players}` : '',
    duration_minutes: event.duration_minutes,
    difficulty: event.difficulty,
    cover_url: event.cover_url
  });
  const res = await db.collection('inventory_items').add({ data });
  await logOperation(admin_user, 'create_inventory_item', 'inventory_items', res._id, data);
  return ok({ item_id: res._id }, '物资已添加');
}

async function admin_createExchangeGood(event, admin_user) {
  const item_name = String(event.item_name || '').trim();
  const exchange_points = toNumber(event.exchange_points, 0);
  const total_quantity = toNumber(event.total_quantity, 0);

  if (!item_name) return fail('商品名称不能为空');
  if (!Number.isInteger(exchange_points) || exchange_points <= 0) return fail('兑换积分必须为正整数');
  if (!Number.isInteger(total_quantity) || total_quantity < 0) return fail('库存不能为负数');

  const data = makeInventoryItem({
    item_name,
    description: event.description,
    category: event.category || 'general',
    item_type: 'exchange_good',
    total_quantity,
    available_quantity: total_quantity,
    exchange_points,
    original_cost: event.original_cost || exchange_points,
    tag_type: event.tag_type,
    tag_text: event.tag_text,
    stock_warning_threshold: event.stock_warning_threshold,
    cover_url: event.cover_url
  });
  const res = await db.collection('inventory_items').add({ data });
  await logOperation(admin_user, 'create_exchange_good', 'inventory_items', res._id, data);
  return ok({ item_id: res._id }, '商品已添加');
}

function normalizeExchangeGood(item = {}) {
  const item_id = item.item_id || item._id || '';
  const available_quantity = toNumber(item.available_quantity, 0);
  const stock_warning_threshold = Math.max(0, toNumber(item.stock_warning_threshold, 3));
  const tag_type = normalizeExchangeGoodTag(item.tag_type);
  return {
    item_id,
    item_name: item.item_name || '',
    description: item.description || '',
    category: item.category || 'general',
    cover_url: item.cover_url || '',
    exchange_points: toNumber(item.exchange_points, 0),
    original_cost: toNumber(item.original_cost, 0),
    total_quantity: toNumber(item.total_quantity, 0),
    available_quantity,
    exchanged_count: toNumber(item.exchanged_count, 0),
    status: item.status || 'available',
    tag_type,
    tag_text: String(item.tag_text || EXCHANGE_GOOD_TAG_TEXT[tag_type] || '').trim(),
    stock_warning_threshold,
    stock_warning: available_quantity <= stock_warning_threshold,
    created_at: item.created_at || '',
    updated_at: item.updated_at || ''
  };
}

async function admin_getExchangeGoods(event) {
  const page = toNumber(event.page, 1);
  const page_size = toNumber(event.page_size, 50);
  const where = { item_type: 'exchange_good', status: _.neq('discontinued') };
  const list = await safeList('inventory_items', {
    where,
    orderBy: { field: 'created_at', direction: 'desc' },
    skip: (page - 1) * page_size,
    limit: page_size
  });
  const total = await safeCount('inventory_items', where);

  return ok({
    list: list.map(normalizeExchangeGood),
    total,
    page,
    page_size,
    has_more: page * page_size < total
  });
}

async function admin_updateExchangeGoodStatus(event, admin_user) {
  const item_id = event.item_id;
  const status = String(event.status || '').trim();
  if (!item_id) return fail('商品编号不能为空');
  if (!['available', 'offline'].includes(status)) return fail('不支持的商品状态');

  const item = await getDoc('inventory_items', item_id);
  if (!item || item.item_type !== 'exchange_good') return fail('兑换商品不存在');

  await updateInventoryItem(item_id, { status });
  await logOperation(admin_user, 'update_exchange_good_status', 'inventory_items', item_id, { status }, { status: item.status || 'available' });
  return ok(null, status === 'available' ? '商品已上架' : '商品已下架');
}

async function admin_getBorrowApplications(event) {
  const page = toNumber(event.page, 1);
  const page_size = toNumber(event.page_size, 30);
  const active_statuses = ['applying', 'confirmed', 'in_transit', 'borrowed'];
  const where = buildStatusDateWhere(event, active_statuses, 'created_at');
  const list = await safeList('borrow_applications', {
    where,
    orderBy: { field: 'created_at', direction: 'desc' },
    skip: (page - 1) * page_size,
    limit: page_size
  });

  const result = await Promise.all(list.map(async (item) => {
    const item_id = item.item_id || '';
    const inventory = await getDoc('inventory_items', item_id);
    const user = await getUserById(item.borrower_id || item.user_id || '');
    return {
      ...item,
      application_id: item.application_id || item._id,
      borrower_id: item.borrower_id || item.user_id || '',
      item_name: item.item_name || (inventory && inventory.item_name) || '借阅物资',
      item_type: (inventory && inventory.item_type) || '',
      borrower_name: item.borrower_name || (user && user.nickname) || '未知用户'
    };
  }));

  return ok({ list: result, page, page_size });
}

async function admin_updateBorrowStatus(event, admin_user) {
  const application_id = event.application_id;
  const status = event.status;
  if (!application_id) return fail('借阅申请编号不能为空');
  if (!['borrowed', 'returned', 'cancelled'].includes(status)) return fail('不支持的借阅状态');

  const application = await getDocByIdOrField('borrow_applications', application_id, 'application_id');
  if (!application) return fail('借阅申请不存在');
  if (['returned', 'cancelled'].includes(application.status)) return fail('该申请已结束，不能重复处理');

  const data = {
    status,
    handled_by: admin_user._id,
    updated_at: db.serverDate()
  };
  let inventory_data = null;
  let message = '借阅状态已更新';

  if (status === 'borrowed') {
    data.lent_at = db.serverDate();
    inventory_data = {
      status: 'borrowed',
      current_borrower_id: application.borrower_id || application.user_id || '',
      current_application_id: application_id
    };
    message = '已确认借出';
  }

  if (status === 'returned') {
    data.returned_at = db.serverDate();
    inventory_data = {
      status: 'available',
      current_borrower_id: '',
      current_application_id: ''
    };
    message = '已确认归还';
  }

  if (status === 'cancelled') {
    data.cancelled_at = db.serverDate();
    inventory_data = {
      status: 'available',
      current_borrower_id: '',
      current_application_id: ''
    };
    message = '借阅申请已取消';
  }

  await db.collection('borrow_applications').doc(application._doc_id).update({ data });
  await updateBorrowRecordMirror(application_id, data);
  if (application.item_id && inventory_data) await updateInventoryItem(application.item_id, inventory_data);

  await logOperation(admin_user, 'update_borrow_status', 'borrow_applications', application_id, { status });

  if (['borrowed', 'returned'].includes(status)) {
    const borrower = await getUserById(application.borrower_id || application.user_id || '');
    if (borrower && borrower.openid) {
      await sendSubscribeMessage(borrower.openid, BORROW_STATUS_CHANGE_TMPL, {
        thing1: { value: asThing(application.item_name || '借阅物资', 20) },
        phrase2: { value: status === 'borrowed' ? '已借出' : '已归还' },
        time3: { value: nowCstText() },
        thing4: { value: asThing(status === 'borrowed' ? '请按约定时间归还' : '借阅流程已完成', 20) }
      }, 'pages/borrow/index');
    }
  }

  return ok(null, message);
}

async function admin_getExchangeRecords(event) {
  const page = toNumber(event.page, 1);
  const page_size = toNumber(event.page_size, 30);
  const where = buildStatusDateWhere(event, ['pending', 'shipped'], 'created_at');
  const list = await safeList('exchange_records', {
    where,
    orderBy: { field: 'created_at', direction: 'desc' },
    skip: (page - 1) * page_size,
    limit: page_size
  });

  const result = await Promise.all(list.map(async (item) => {
    const user = await getUserById(item.user_id || '');
    const exchange_id = item.exchange_id || item._id;
    return {
      ...item,
      exchange_id,
      item_id: item.item_id || item.goods_id || '',
      points_cost: toNumber(item.points_cost || item.total_cost, 0),
      total_cost: toNumber(item.total_cost || item.points_cost, 0),
      user_name: (user && user.nickname) || '未知用户'
    };
  }));

  return ok({ list: result, page, page_size });
}

async function admin_updateExchangeStatus(event, admin_user) {
  const exchange_id = event.exchange_id;
  const status = event.status;
  if (!exchange_id) return fail('兑换记录编号不能为空');
  if (!['completed', 'cancelled'].includes(status)) return fail('不支持的兑换状态');

  const record = await getDocByIdOrField('exchange_records', exchange_id, 'exchange_id');
  if (!record) return fail('兑换记录不存在');
  if (['completed', 'received', 'cancelled'].includes(record.status)) return fail('该兑换记录已结束，不能重复处理');

  const total_cost = toNumber(record.points_cost || record.total_cost, 0);
  const quantity = toNumber(record.quantity, 1);
  const user = await getUserById(record.user_id);
  const data = {
    status,
    handled_by: admin_user._id,
    handled_at: db.serverDate(),
    updated_at: db.serverDate()
  };

  await db.collection('exchange_records').doc(record._doc_id).update({ data });

  if (user) {
    const current = readPoints(user, await ensurePointAccount(user));
    if (status === 'completed') {
      await syncPoints(user, {
        ...current,
        frozen_points: Math.max(0, current.frozen_points - total_cost),
        used_points: current.used_points + total_cost
      });
      await addPointsLog({
        user_id: user._id,
        amount: -total_cost,
        type: 'expense',
        business_type: 'exchange_complete',
        reason: `积分兑换 - ${record.goods_name || record.item_name || '兑换商品'}`,
        related_id: exchange_id
      });
    } else {
      await syncPoints(user, {
        ...current,
        available_points: current.available_points + total_cost,
        frozen_points: Math.max(0, current.frozen_points - total_cost)
      });
      await addPointsLog({
        user_id: user._id,
        amount: total_cost,
        type: 'unfreeze',
        business_type: 'exchange_cancel',
        reason: `兑换取消返还 - ${record.goods_name || record.item_name || '兑换商品'}`,
        related_id: exchange_id
      });
    }
  }

  if (status === 'cancelled' && (record.item_id || record.goods_id)) {
    const item_id = record.item_id || record.goods_id;
    const goods = await getDoc('inventory_items', item_id);
    if (goods) {
      await updateInventoryItem(item_id, {
        available_quantity: toNumber(goods.available_quantity, 0) + quantity,
        exchanged_count: Math.max(0, toNumber(goods.exchanged_count, 0) - quantity)
      });
    }
  }

  await logOperation(admin_user, 'update_exchange_status', 'exchange_records', exchange_id, { status, total_cost });
  return ok(null, status === 'completed' ? '兑换已完成' : '兑换已取消');
}

async function admin_createDudKeyword(event, admin_user) {
  const keyword_list = String(event.keyword || '')
    .split(/[,，\n]/)
    .map(item => item.trim())
    .filter(Boolean);
  const reply_content = String(event.reply_content || '').trim();

  if (keyword_list.length === 0) return fail('关键词不能为空');
  if (!reply_content) return fail('回复内容不能为空');

  const data = {
    rule_name: String(event.rule_name || keyword_list[0]).trim(),
    keyword: keyword_list[0],
    keywords: keyword_list,
    reply_content,
    match_type: event.match_type || 'exact',
    priority: toNumber(event.priority, 0),
    is_enabled: event.is_enabled !== false,
    created_by: admin_user._id,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const res = await db.collection('dud_keywords').add({ data });
  await logOperation(admin_user, 'create_dud_keyword', 'dud_keywords', res._id, data);
  return ok({ rule_id: res._id }, '关键词已添加');
}

async function admin_createRecommendation(event, admin_user) {
  const title = String(event.title || '').trim();
  const reason = String(event.reason || '').trim();
  if (!title) return fail('推荐标题不能为空');
  if (!reason) return fail('推荐理由不能为空');

  const data = {
    title,
    category: event.category || 'book',
    recommender_name: String(event.recommender_name || 'NK推协').trim(),
    reason,
    article_url: String(event.link_url || event.article_url || '').trim(),
    cover_url: String(event.cover_url || '').trim(),
    status: event.status || 'published',
    published_at: db.serverDate(),
    created_by: admin_user._id,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const res = await db.collection('recommendations').add({ data });
  await db.collection('recommendations').doc(res._id).update({ data: { recommendation_id: res._id } });
  await logOperation(admin_user, 'create_recommendation', 'recommendations', res._id, data);
  return ok({ recommendation_id: res._id }, '推荐已发布');
}

async function admin_updateRecommendationStatus(event, admin_user) {
  const recommendation_id = event.recommendation_id;
  if (!recommendation_id) return fail('推荐编号不能为空');
  const data = {
    status: event.status || 'published',
    updated_at: db.serverDate()
  };
  await db.collection('recommendations').doc(recommendation_id).update({ data });
  await logOperation(admin_user, 'update_recommendation_status', 'recommendations', recommendation_id, data);
  return ok(null, '推荐状态已更新');
}

async function admin_getFeedback(event) {
  const page = toNumber(event.page, 1);
  const page_size = toNumber(event.page_size, 50);
  const where = buildStatusDateWhere(event, ['pending', 'processing'], 'created_at');
  const list = await safeList('feedback', {
    where,
    orderBy: { field: 'created_at', direction: 'desc' },
    skip: (page - 1) * page_size,
    limit: page_size
  });
  return ok({ list, page, page_size });
}

async function admin_updateFeedback(event, admin_user) {
  const feedback_id = event.feedback_id;
  if (!feedback_id) return fail('反馈编号不能为空');

  const data = {
    status: event.status || 'resolved',
    admin_remark: String(event.admin_remark || '').trim(),
    admin_reply: String(event.admin_reply || event.admin_remark || '').trim(),
    handled_by: admin_user._id,
    handled_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const feedback = await getDocByIdOrField('feedback', feedback_id, 'feedback_id');
  if (!feedback) return fail('反馈不存在');

  await db.collection('feedback').doc(feedback._doc_id).update({ data });
  await logOperation(admin_user, 'update_feedback', 'feedback', feedback_id, data);
  return ok(null, '反馈已更新');
}

async function admin_getSystemSettings() {
  const list = await safeList('system_settings', { where: { setting_key: 'global' }, limit: 1 });
  const settings = list[0] ? (list[0].settings || list[0].setting_value || {}) : {};
  return ok({ ...DEFAULT_SYSTEM_SETTINGS, ...settings });
}

async function admin_saveSystemSettings(event, admin_user) {
  const data = {
    puzzle_publish_time: String(event.puzzle_publish_time || DEFAULT_SYSTEM_SETTINGS.puzzle_publish_time).trim(),
    default_puzzle_reward: toNumber(event.default_puzzle_reward, DEFAULT_SYSTEM_SETTINGS.default_puzzle_reward),
    activity_cancel_hours: toNumber(event.activity_cancel_hours, DEFAULT_SYSTEM_SETTINGS.activity_cancel_hours),
    recommendation_enabled: event.recommendation_enabled !== false,
    commission_enabled: event.commission_enabled !== false
  };
  if (data.default_puzzle_reward < 0) return fail('谜题奖励不能为负数');
  if (!Number.isInteger(data.activity_cancel_hours) || data.activity_cancel_hours < 1 || data.activity_cancel_hours > 24) return fail('活动取消提前小时数必须在 1-24 之间');

  const existed = await safeList('system_settings', { where: { setting_key: 'global' }, limit: 1 });
  let setting_id = '';
  if (existed.length > 0) {
    setting_id = existed[0]._id;
    await db.collection('system_settings').doc(setting_id).update({
      data: {
        setting_id: existed[0].setting_id || setting_id,
        setting_key: 'global',
        settings: data,
        setting_value: data,
        updated_at: db.serverDate()
      }
    });
  } else {
    const res = await db.collection('system_settings').add({
      data: {
        setting_key: 'global',
        settings: data,
        setting_value: data,
        description: '系统全局设置',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    setting_id = res._id;
    await db.collection('system_settings').doc(setting_id).update({ data: { setting_id } });
  }

  await logOperation(admin_user, 'save_system_settings', 'system_settings', setting_id, data);
  return ok(data, '系统设置已保存');
}

async function admin_getLogs(event) {
  const page = toNumber(event.page, 1);
  const page_size = toNumber(event.page_size, 30);
  const list = await safeList('admin_logs', {
    orderBy: { field: 'created_at', direction: 'desc' },
    skip: (page - 1) * page_size,
    limit: page_size
  });
  return ok({ list: list.map(normalizeLog), page, page_size });
}

exports.main = async (event) => {
  const { action = 'getDashboard', ...data } = event;
  const actions = {
    getDashboard: admin_getDashboard,
    savePuzzle: admin_savePuzzle,
    createActivity: admin_createActivity,
    getActivityRegistrations: admin_getActivityRegistrations,
    confirmActivityAttendance: admin_confirmActivityAttendance,
    createBorrowItem: admin_createBorrowItem,
    createExchangeGood: admin_createExchangeGood,
    getExchangeGoods: admin_getExchangeGoods,
    updateExchangeGoodStatus: admin_updateExchangeGoodStatus,
    getBorrowApplications: admin_getBorrowApplications,
    updateBorrowStatus: admin_updateBorrowStatus,
    getExchangeRecords: admin_getExchangeRecords,
    updateExchangeStatus: admin_updateExchangeStatus,
    createDudKeyword: admin_createDudKeyword,
    createRecommendation: admin_createRecommendation,
    updateRecommendationStatus: admin_updateRecommendationStatus,
    getFeedback: admin_getFeedback,
    updateFeedback: admin_updateFeedback,
    getSystemSettings: admin_getSystemSettings,
    saveSystemSettings: admin_saveSystemSettings,
    getLogs: admin_getLogs
  };
  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return withAdmin(data, handler);
};
