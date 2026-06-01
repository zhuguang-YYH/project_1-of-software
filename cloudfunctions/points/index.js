const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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
  const data = {
    user_id: user._id,
    ...points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const res = await db.collection('point_accounts').add({ data });
  return { _id: res._id, ...data };
}

async function syncPointAccountAndUser(user, next_points) {
  const data = {
    total_points: numberValue(next_points.total_points, 0),
    available_points: numberValue(next_points.available_points, 0),
    frozen_points: numberValue(next_points.frozen_points, 0),
    used_points: numberValue(next_points.used_points, 0),
    updated_at: db.serverDate()
  };

  await db.collection('users').doc(user._id).update({ data });
  const account = await ensurePointAccount(user);
  await db.collection('point_accounts').doc(account._id).update({ data });
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
    return ok(readPoints(user, account), '获取成功');
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

  const account = await ensurePointAccount(user);
  const current = readPoints(user, account);
  if (direction === 'deduct' && current.available_points < delta) return fail('可用积分不足');

  const next_points = direction === 'add'
    ? {
        ...current,
        total_points: current.total_points + delta,
        available_points: current.available_points + delta
      }
    : {
        ...current,
        available_points: current.available_points - delta,
        used_points: current.used_points + delta
      };

  await syncPointAccountAndUser(user, next_points);
  await addPointLog({
    user,
    amount: direction === 'add' ? delta : -delta,
    reason,
    type: direction === 'add' ? 'income' : 'expense',
    point_type: 'available',
    business_type: 'admin_adjust'
  });

  return ok(next_points, direction === 'add' ? '增加成功' : '扣除成功');
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
    const current = readPoints(user, account);
    if (current.available_points < amount) return fail('可用积分不足');

    const next_points = {
      ...current,
      available_points: current.available_points - amount,
      frozen_points: current.frozen_points + amount
    };
    await syncPointAccountAndUser(user, next_points);
    await addPointLog({
      user,
      amount: -amount,
      type: 'freeze',
      point_type: 'available',
      business_type: 'manual_freeze',
      reason: '积分冻结'
    });

    return ok(next_points, '冻结成功');
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

    const account = await ensurePointAccount(user);
    const current = readPoints(user, account);
    const release_amount = Math.min(amount, current.frozen_points);
    const next_points = {
      ...current,
      available_points: current.available_points + release_amount,
      frozen_points: current.frozen_points - release_amount
    };
    await syncPointAccountAndUser(user, next_points);
    await addPointLog({
      user,
      amount: release_amount,
      type: 'unfreeze',
      point_type: 'available',
      business_type: 'manual_unfreeze',
      reason: '积分解冻'
    });

    return ok(next_points, '解冻成功');
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

exports.main = async (event, context) => {
  const { action = 'getUserPoints', ...data } = event || {};
  const actions = {
    getUserPoints: points_getUserPoints,
    addPoints: points_addPoints,
    deductPoints: points_deductPoints,
    getHistory: points_getHistory,
    freezePoints: points_freezePoints,
    unfreezePoints: points_unfreezePoints,
    getAnalysis: points_getAnalysis
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
