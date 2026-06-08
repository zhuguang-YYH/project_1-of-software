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

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.$date) return new Date(value.$date);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeActivity(activity = {}) {
  const activity_id = activity.activity_id || activity._id || '';
  const registered_count = numberValue(activity.registered_count, 0);
  const capacity = numberValue(activity.capacity, 0);

  return {
    activity_id,
    title: activity.title || '',
    description: activity.description || '',
    location: activity.location || '',
    capacity,
    registered_count,
    remaining_capacity: Math.max(0, capacity - registered_count),
    cancel_deadline: activity.cancel_deadline || '',
    start_time: activity.start_time || '',
    end_time: activity.end_time || '',
    status: activity.status || 'recruiting',
    created_by: activity.created_by || '',
    created_at: activity.created_at || '',
    updated_at: activity.updated_at || ''
  };
}

function normalizeRegistration(reg = {}) {
  const registration_id = reg.registration_id || reg._id || '';
  return {
    registration_id,
    activity_id: reg.activity_id || '',
    user_id: reg.user_id || '',
    reason: reg.reason || '',
    status: reg.status || 'registered',
    can_not_cancel_confirm: !!reg.can_not_cancel_confirm,
    registered_at: reg.registered_at || '',
    cancelled_at: reg.cancelled_at || '',
    updated_at: reg.updated_at || ''
  };
}

async function getCurrentUser(openid) {
  if (!openid) return null;
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function getActiveRegistration(user, activity_id) {
  if (!user || !user._id || !activity_id) return null;
  try {
    const res = await db.collection('activity_registrations')
      .where({ user_id: user._id, activity_id, status: _.neq('cancelled') })
      .limit(1)
      .get();
    return res.data[0] || null;
  } catch (error) {
    if (isCollectionMissing(error)) return null;
    throw error;
  }
}

async function listMyRegistrations(user, page, page_size) {
  if (!user || !user._id) return { list: [], total: 0 };
  const where = { user_id: user._id };
  const res = await db.collection('activity_registrations')
    .where(where)
    .orderBy('registered_at', 'desc')
    .skip((page - 1) * page_size)
    .limit(page_size)
    .get();
  const count_res = await db.collection('activity_registrations').where(where).count();
  return { list: res.data || [], total: count_res.total };
}

async function getUserRegistrationsMap(userId, activityIds) {
  if (!userId || !activityIds || !activityIds.length) return new Map();
  try {
    const res = await db.collection('activity_registrations')
      .where({ user_id: userId, activity_id: _.in(activityIds), status: _.neq('cancelled') })
      .get();
    const map = new Map();
    for (const item of res.data || []) {
      map.set(item.activity_id, normalizeRegistration(item));
    }
    return map;
  } catch (error) {
    return new Map();
  }
}

async function activity_getActivities(event) {
  try {
    const wx_context = cloud.getWXContext();
    const page = Math.max(numberValue(event.page, 1), 1);
    const page_size = Math.min(Math.max(numberValue(event.page_size, 10), 1), 50);
    const res = await db.collection('activities')
      .where({ status: _.neq('cancelled') })
      .orderBy('start_time', 'asc')
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();
    const count_res = await db.collection('activities').where({ status: _.neq('cancelled') }).count();

    const list = (res.data || []).map(normalizeActivity);
    const user = await getCurrentUser(wx_context.OPENID);
    if (user && list.length > 0) {
      const activityIds = list.map(a => a.activity_id).filter(Boolean);
      const regMap = await getUserRegistrationsMap(user._id, activityIds);
      list.forEach(activity => {
        const reg = regMap.get(activity.activity_id) || null;
        activity.user_registration = reg;
        activity.is_registered = reg !== null;
      });
    }

    return ok({
      list,
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    }, '获取成功');
  } catch (error) {
    return fail('获取活动列表失败: ' + error.message);
  }
}

async function activity_getMyActivities(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const page = Math.max(numberValue(event.page, 1), 1);
    const page_size = Math.min(Math.max(numberValue(event.page_size, 10), 1), 50);
    if (!user) return fail('请先完成授权登录');

    const records = await listMyRegistrations(user, page, page_size);
    const list = await Promise.all(records.list.map(async (item) => {
      const reg = normalizeRegistration(item);
      let activity = null;
      try {
        const act_res = await db.collection('activities').doc(reg.activity_id).get();
        activity = normalizeActivity(act_res.data);
      } catch (error) {
        activity = null;
      }
      return { ...reg, activity };
    }));

    return ok({
      list,
      total: records.total,
      page,
      page_size,
      has_more: page * page_size < records.total
    }, '获取成功');
  } catch (error) {
    return fail('获取我的活动失败: ' + error.message);
  }
}

async function activity_registerActivity(event) {
  let count_incremented = false;
  let stable_id = '';
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const activity_id = event.activity_id;
    const reason = String(event.reason || '').trim();
    const confirmed = !!(event.can_not_cancel_confirm || event.cannot_cancel_confirmed);

    if (!user) return fail('请先完成授权登录');
    if (!activity_id) return fail('活动编号不能为空');

    const act_res = await db.collection('activities').doc(activity_id).get();
    const activity = normalizeActivity(act_res.data);

    // 快速路径：查询已有报名记录
    const existing_registration = await getActiveRegistration(user, activity_id);
    if (existing_registration) return fail('您已经报名过此活动');

    const cancel_deadline = toDate(activity.cancel_deadline);
    if (cancel_deadline && new Date() > cancel_deadline && !confirmed) {
      return fail('当前活动报名后不可取消，请确认后再提交', 'CANCEL_CONFIRM_REQUIRED');
    }

    if (activity.capacity > 0 && activity.registered_count >= activity.capacity) {
      return fail('活动已满员');
    }

    // 幂等防重：用 user_id + activity_id 拼接稳定 _id
    // 微信云数据库 _id 唯一，并发重复 add 第二次必失败 → 天然防重
    stable_id = `ar_${user._id}_${activity_id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);

    // 1) 先插入报名记录（稳定 _id 作为数据库层去重锁）
    try {
      await db.collection('activity_registrations').add({
        data: {
          _id: stable_id,
          registration_id: stable_id,
          user_id: user._id,
          activity_id,
          reason,
          status: 'registered',
          can_not_cancel_confirm: confirmed,
          registered_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
    } catch (error) {
      // _id 冲突：说明已被并发写入或曾经报名过，幂等返回
      const dup = await getActiveRegistration(user, activity_id);
      if (dup) {
        return ok({
          registration_id: dup.registration_id || dup._id,
          idempotent: true
        }, '您已经报名过此活动');
      }
      throw error;
    }

    // 2) 原子增加活动报名人数
    const update_res = await db.collection('activities')
      .where({
        _id: activity_id,
        status: _.neq('cancelled'),
        registered_count: activity.capacity > 0 ? _.lt(activity.capacity) : _.gte(0)
      })
      .update({
        data: {
          registered_count: _.inc(1),
          updated_at: db.serverDate()
        }
      });

    if (update_res.stats && update_res.stats.updated === 0) {
      // 报名人数已达上限：回滚已插入的报名记录
      await db.collection('activity_registrations').doc(stable_id).update({
        data: { status: 'cancelled', cancelled_at: db.serverDate(), updated_at: db.serverDate() }
      });
      return fail('活动已满员或状态已变化');
    }
    count_incremented = true;

    return ok({ registration_id: stable_id }, '报名成功');
  } catch (error) {
    if (count_incremented && stable_id) {
      try {
        await db.collection('activity_registrations').doc(stable_id).update({
          data: { status: 'cancelled', cancelled_at: db.serverDate(), updated_at: db.serverDate() }
        });
      } catch (e) { /* 回滚失败静默 */ }
    }
    return fail('报名失败: ' + error.message);
  }
}

async function activity_cancelRegister(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const activity_id = event.activity_id;
    let registration_id = event.registration_id;

    if (!user) return fail('请先完成授权登录');

    if (!registration_id && activity_id) {
      const reg = await getActiveRegistration(user, activity_id);
      registration_id = reg && reg._id;
    }
    if (!registration_id) return fail('未找到有效报名记录');

    const reg_res = await db.collection('activity_registrations').doc(registration_id).get();
    const reg = normalizeRegistration(reg_res.data || {});
    if (reg.user_id !== user._id) return fail('只能取消自己的报名记录');

    const final_activity_id = activity_id || reg.activity_id;
    if (final_activity_id) {
      const act_res = await db.collection('activities').doc(final_activity_id).get();
      const activity = normalizeActivity(act_res.data);
      const cancel_deadline = toDate(activity.cancel_deadline);
      if (cancel_deadline && new Date() > cancel_deadline) {
        return fail('已超过最晚取消时间，无法取消报名', 'CANCEL_DEADLINE_PASSED');
      }
    }

    const cancel_res = await db.collection('activity_registrations')
      .where({ _id: registration_id, status: _.neq('cancelled') })
      .update({
        data: {
          status: 'cancelled',
          cancelled_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });

    if (cancel_res.stats && cancel_res.stats.updated === 0) return fail('报名记录已取消');

    if (final_activity_id) {
      await db.collection('activities').doc(final_activity_id).update({
        data: {
          registered_count: _.inc(-1),
          updated_at: db.serverDate()
        }
      });
    }

    return ok(null, '取消报名成功');
  } catch (error) {
    return fail('取消报名失败: ' + error.message);
  }
}

async function activity_getActivityDetail(event) {
  try {
    const activity_id = event.activity_id;
    if (!activity_id) return fail('活动编号不能为空');

    const res = await db.collection('activities').doc(activity_id).get();
    return ok(normalizeActivity(res.data), '获取成功');
  } catch (error) {
    return fail('获取活动详情失败: ' + error.message);
  }
}

async function activity_getStats() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const now = new Date();
    const [activity_count, upcoming_count, my_count, attended_count] = await Promise.all([
      db.collection('activities').count(),
      db.collection('activities').where({ start_time: _.gte(now), status: _.neq('cancelled') }).count(),
      user ? db.collection('activity_registrations').where({ user_id: user._id }).count() : Promise.resolve({ total: 0 }),
      user ? db.collection('activity_registrations').where({ user_id: user._id, status: 'attended' }).count() : Promise.resolve({ total: 0 })
    ]);

    return ok({
      total_activities: activity_count.total,
      upcoming_activities: upcoming_count.total,
      my_registrations: my_count.total,
      attended_activities: attended_count.total
    }, '获取成功');
  } catch (error) {
    return fail('获取活动统计失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getActivities', ...data } = event || {};
  const actions = {
    getActivities: activity_getActivities,
    getMyActivities: activity_getMyActivities,
    register: activity_registerActivity,
    registerActivity: activity_registerActivity,
    confirmRegister: activity_registerActivity,
    cancelRegister: activity_cancelRegister,
    cancel: activity_cancelRegister,
    getActivityDetail: activity_getActivityDetail,
    getStats: activity_getStats
  };
  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
