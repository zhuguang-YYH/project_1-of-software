const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

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

function numberValue(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function readPoints(user = {}, account = {}) {
  return {
    total_points: numberValue(account.total_points || user.total_points, 0),
    available_points: numberValue(account.available_points || user.available_points, 0),
    frozen_points: numberValue(account.frozen_points || user.frozen_points, 0),
    used_points: numberValue(account.used_points || user.used_points, 0)
  };
}

function normalizeLog(item = {}) {
  const amount = numberValue(item.change_amount !== undefined ? item.change_amount : item.amount, 0);
  const type = item.type || (amount < 0 ? 'expense' : 'income');

  return {
    log_id: item.log_id || item.transaction_id || item._id || '',
    user_id: item.user_id || '',
    amount,
    change_amount: amount,
    type,
    point_type: item.point_type || 'available',
    business_type: item.business_type || '',
    related_id: item.related_id || '',
    reason: item.reason || item.description || '积分变动',
    created_at: item.created_at || ''
  };
}

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function getUserById(user_id) {
  if (!user_id) return null;
  try {
    const res = await db.collection('users').doc(user_id).get();
    return res.data || null;
  } catch (error) {
    const list = await db.collection('users').where({ user_id }).limit(1).get();
    return list.data[0] || null;
  }
}

async function ensurePointAccount(user) {
  try {
    const res = await db.collection('point_accounts').where({ user_id: user._id }).limit(1).get();
    if (res.data.length > 0) return res.data[0];
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }

  const points = readPoints(user);
  // 使用 user_id 派生稳定 _id，防止并发重复创建
  const stableId = `pa_${user._id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
  const data = {
    _id: stableId,
    user_id: user._id,
    ...points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  try {
    const res = await db.collection('point_accounts').add({ data });
    return { _id: res._id, ...data };
  } catch (error) {
    // _id 冲突 → 并发创建，读取已存在的记录
    if (!isCollectionMissing(error)) {
      const existed = await db.collection('point_accounts').doc(stableId).get();
      if (existed.data) return existed.data;
    }
    throw error;
  }
}

// 原子增量更新积分：对 users 与 point_accounts 同步 _.inc。
// 取代"先读后写 + 绝对值覆盖"，避免并发丢更新，也避免覆盖其它云函数
// （exchange/commission/puzzle/activity）对同一账户的原子 inc 变更。
// guard 作为 users 表的附加条件（如扣减/冻结要求余额足额）；命中 0 行返回 false。
async function applyPointsDelta(user_id, deltas, guard) {
  const incData = { updated_at: db.serverDate() };
  ['total_points', 'available_points', 'frozen_points', 'used_points'].forEach((key) => {
    if (deltas[key]) incData[key] = _.inc(deltas[key]);
  });

  const where = guard ? { _id: user_id, ...guard } : { _id: user_id };
  const res = await db.collection('users').where(where).update({ data: incData });
  if (!res.stats || res.stats.updated === 0) return false;

  try {
    await db.collection('point_accounts').where({ user_id }).update({ data: incData });
  } catch (e) { if (!isCollectionMissing(e)) throw e; }
  return true;
}

// 变更后回读权威积分快照用于返回
async function reloadPoints(user_id) {
  const user = await getUserById(user_id);
  if (!user) return readPoints();
  const account = await ensurePointAccount(user);
  return readPoints(user, account);
}

async function addPointLog({ user, amount, type, point_type = 'available', business_type = 'admin_adjust', related_id = '', reason }) {
  try {
    await db.collection('points_log').add({
      data: {
        user_id: user._id,
        amount,
        change_amount: amount,
        point_type,
        type,
        business_type,
        related_id,
        reason,
        description: reason,
        created_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
}

async function ensureAdmin(openid) {
  if (!openid) return { allowed: false, message: '缺少登录态' };
  const user = await getCurrentUser(openid);
  if (!user) return { allowed: false, message: '用户不存在' };
  if (user.role === 'admin') return { allowed: true, user };

  // 仅在环境变量 BOOTSTRAP_ADMIN_OPENID 显式匹配时才允许首位管理员引导。
  const bootstrap = String(process.env.BOOTSTRAP_ADMIN_OPENID || '').trim();
  if (bootstrap && bootstrap === openid) {
    const admin_res = await db.collection('users').where({ role: 'admin' }).limit(1).get();
    if (admin_res.data.length === 0) return { allowed: true, user };
  }
  return { allowed: false, message: '仅管理员可调整积分' };
}

async function points_getUserPoints() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('用户不存在');

    const account = await ensurePointAccount(user);
    return ok({
      ...readPoints(user, account),
      last_checkin_date: account.last_checkin_date || '',
      checkin_streak: numberValue(account.checkin_streak, 0)
    }, '获取成功');
  } catch (error) {
    return fail('获取积分失败: ' + error.message);
  }
}

async function adjustPoints(event, direction) {
  const wx_context = cloud.getWXContext();
  const check = await ensureAdmin(wx_context.OPENID);
  if (!check.allowed) return fail(check.message, 'PERMISSION_DENIED');

  const user_id = event.user_id;
  const delta = numberValue(event.points || event.amount, 0);
  const reason = String(event.reason || '').trim();

  if (!user_id) return fail('用户编号不能为空');
  if (!Number.isInteger(delta) || delta <= 0) return fail('积分数量必须为正整数');
  if (!reason) return fail('积分调整原因不能为空');

  const user = await getUserById(user_id);
  if (!user) return fail('用户不存在');

  await ensurePointAccount(user);

  // 原子加/扣：扣减时以 available_points 足额为条件，命中 0 行即余额不足。
  let applied;
  if (direction === 'add') {
    applied = await applyPointsDelta(user._id, { total_points: delta, available_points: delta });
  } else {
    applied = await applyPointsDelta(
      user._id,
      { available_points: -delta, used_points: delta },
      { available_points: _.gte(delta) }
    );
  }
  if (!applied) return fail('可用积分不足');

  await addPointLog({
    user,
    amount: direction === 'add' ? delta : -delta,
    reason,
    type: direction === 'add' ? 'income' : 'expense',
    point_type: 'available',
    business_type: 'admin_adjust'
  });

  return ok(await reloadPoints(user._id), direction === 'add' ? '增加成功' : '扣除成功');
}

async function points_addPoints(event) {
  try {
    return await adjustPoints(event, 'add');
  } catch (error) {
    return fail('增加积分失败: ' + error.message);
  }
}

async function points_deductPoints(event) {
  try {
    return await adjustPoints(event, 'deduct');
  } catch (error) {
    return fail('扣除积分失败: ' + error.message);
  }
}

async function points_getHistory(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const page = numberValue(event.page, 1);
    const page_size = numberValue(event.page_size, 10);
    const type = event.type || '';

    if (!user) return fail('用户不存在');

    const where = type ? { user_id: user._id, type } : { user_id: user._id };
    const res = await db.collection('points_log')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();
    const count_res = await db.collection('points_log').where(where).count();

    return ok({
      list: (res.data || []).map(normalizeLog),
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) {
      return ok({ list: [], total: 0, page: 1, page_size: 10, has_more: false }, '获取成功');
    }
    return fail('获取积分流水失败: ' + error.message);
  }
}

async function points_freezePoints(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const amount = numberValue(event.amount, 0);

    if (!user) return fail('用户不存在');
    if (!Number.isInteger(amount) || amount <= 0) return fail('冻结积分必须为正整数');

    const account = await ensurePointAccount(user);
    if (numberValue(account.available_points || user.available_points, 0) < amount) {
      // 快速失败提示；真正的并发安全由下方条件原子更新保证
      return fail('可用积分不足');
    }

    const applied = await applyPointsDelta(
      user._id,
      { available_points: -amount, frozen_points: amount },
      { available_points: _.gte(amount) }
    );
    if (!applied) return fail('可用积分不足');

    await addPointLog({
      user,
      amount: -amount,
      type: 'freeze',
      point_type: 'available',
      business_type: 'manual_freeze',
      reason: '积分冻结'
    });

    return ok(await reloadPoints(user._id), '冻结成功');
  } catch (error) {
    return fail('冻结积分失败: ' + error.message);
  }
}

async function points_unfreezePoints(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const amount = numberValue(event.amount, 0);

    if (!user) return fail('用户不存在');
    if (!Number.isInteger(amount) || amount <= 0) return fail('解冻积分必须为正整数');

    await ensurePointAccount(user);

    // 优先原子解冻 amount（冻结额足额时）
    let release_amount = amount;
    let applied = await applyPointsDelta(
      user._id,
      { available_points: amount, frozen_points: -amount },
      { frozen_points: _.gte(amount) }
    );

    // 冻结额不足 amount：按当前冻结额做 CAS 全额解冻，避免 frozen 变负
    if (!applied) {
      const account = await ensurePointAccount(user);
      const frozen = numberValue(account.frozen_points, 0);
      if (frozen <= 0) return ok(await reloadPoints(user._id), '解冻成功');
      release_amount = frozen;
      applied = await applyPointsDelta(
        user._id,
        { available_points: frozen, frozen_points: -frozen },
        { frozen_points: frozen }
      );
      if (!applied) return fail('解冻失败，请重试');
    }

    await addPointLog({
      user,
      amount: release_amount,
      type: 'unfreeze',
      point_type: 'available',
      business_type: 'manual_unfreeze',
      reason: '积分解冻'
    });

    return ok(await reloadPoints(user._id), '解冻成功');
  } catch (error) {
    return fail('解冻积分失败: ' + error.message);
  }
}

async function points_getAnalysis() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('用户不存在');

    const res = await db.collection('points_log')
      .where({ user_id: user._id })
      .orderBy('created_at', 'desc')
      .limit(100)
      .get();
    const distribution = {};

    for (const item of res.data || []) {
      const key = item.business_type || item.type || 'other';
      const amount = numberValue(item.change_amount || item.amount, 0);
      if (!distribution[key]) {
        distribution[key] = { business_type: key, income: 0, expense: 0, count: 0 };
      }
      distribution[key].count += 1;
      if (amount >= 0) {
        distribution[key].income += amount;
      } else {
        distribution[key].expense += Math.abs(amount);
      }
    }

    return ok({
      sources: Object.values(distribution),
      distribution
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ sources: [], distribution: {} }, '获取成功');
    return fail('获取积分分析失败: ' + error.message);
  }
}

async function points_dailyCheckin() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('用户不存在');

    const today = new Date().toISOString().split('T')[0];
    const account = await ensurePointAccount(user);

    // Check if already checked in today
    if (account.last_checkin_date === today) {
      return ok({
        points: 0,
        message: '今日已签到',
        last_checkin_date: today,
        checkin_streak: numberValue(account.checkin_streak, 0)
      });
    }

    // Calculate streak: +1 if yesterday was checked in, otherwise reset to 1
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const streak = account.last_checkin_date === yesterday
      ? numberValue(account.checkin_streak, 0) + 1
      : 1;

    const bonus_points = Math.min(5 + Math.floor(streak / 7), 15); // Base 5, +1 per week, max 15

    // Atomic update
    const applied = await applyPointsDelta(
      user._id,
      { total_points: bonus_points, available_points: bonus_points }
    );
    if (!applied) return fail('签到失败，请重试');

    // Update checkin info on point_account
    try {
      await db.collection('point_accounts').doc(account._id).update({
        data: {
          last_checkin_date: today,
          checkin_streak: streak,
          updated_at: db.serverDate()
        }
      });
    } catch (e) { if (!isCollectionMissing(e)) throw e; }

    await addPointLog({
      user,
      amount: bonus_points,
      reason: `每日签到 (连续第${streak}天)`,
      type: 'income',
      point_type: 'available',
      business_type: 'daily_checkin'
    });

    return ok({
      points: bonus_points,
      checkin_streak: streak,
      last_checkin_date: today
    }, '签到成功');
  } catch (error) {
    return fail('签到失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getUserPoints', ...data } = event || {};
  const actions = {
    getUserPoints: points_getUserPoints,
    addPoints: points_addPoints,
    deductPoints: points_deductPoints,
    getHistory: points_getHistory,
    freezePoints: points_freezePoints,
    unfreezePoints: points_unfreezePoints,
    getAnalysis: points_getAnalysis,
    dailyCheckin: points_dailyCheckin
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
