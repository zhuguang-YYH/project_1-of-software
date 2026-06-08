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

function safeIdPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function buildRegistrationId(user_id, activity_id) {
  return `activity_reg_${safeIdPart(activity_id)}_${safeIdPart(user_id)}`;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.$date) return new Date(value.$date);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// 报名成功订阅消息模板
const REGISTER_SUCCESS_TMPL = '2SAlGSbn0Ion8Dv94MobCQLf3r2T8P919gbHMMMCCI';
// 活动开始提醒订阅消息模板
const ACTIVITY_REMINDER_TMPL = 'SJizBGlxHBBon30-DOqXYlOFGHmDHlrA8z_l4a2acjg';
// 默认开始前多少小时提醒（可用环境变量覆盖）
const REMIND_AHEAD_HOURS = Number(process.env.REMIND_AHEAD_HOURS) || 24;
// 单次定时运行最多处理多少条提醒，避免超时
const REMIND_MAX_PER_RUN = 400;

// 截断为 thing 类型可接受长度（≤20），空值兜底
function asThing(value, max = 20) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : '—';
}

// 下发订阅消息（best-effort：用户未授权/格式异常都不影响主流程）
async function sendSubscribeMessage(touser, templateId, data, page) {
  if (!touser) return false;
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

// 把活动时间文本按"墙上时钟"解析为可比较的毫秒数（无时区时 Node 以 UTC 解析，
// 与下面 Beijing-now 同样按 UTC 数值表达，比较一致）。无法解析返回 NaN。
function parseWallClockTs(text) {
  return Date.parse(String(text || '').replace(/\//g, '-'));
}

// 当前北京时间的"墙上时钟"毫秒（用于与 parseWallClockTs 比较）
function beijingNowTs() {
  return Date.now() + 8 * 3600 * 1000;
}

// 把墙上时钟毫秒格式化为 "YYYY-MM-DD HH:mm"（微信 time 类型可接受）
function formatWallClock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// 批量按 _id 取用户 openid，返回 { user_id: openid }
async function mapUserOpenids(user_ids) {
  const result = {};
  const ids = Array.from(new Set(user_ids.filter(Boolean)));
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    try {
      const res = await db.collection('users').where({ _id: _.in(batch) }).limit(20).get();
      (res.data || []).forEach((u) => { if (u.openid) result[u._id] = u.openid; });
    } catch (error) {
      console.warn('[reminder] load users failed:', error && error.message);
    }
  }
  return result;
}

// 定时触发：扫描"即将开始且未提醒"的活动报名，下发活动开始提醒。
// 幂等：每条报名记录用 reminder_sent 标记，已发送的不再重复。
async function runActivityReminder() {
  const nowTs = beijingNowTs();
  const windowTs = nowTs + REMIND_AHEAD_HOURS * 3600 * 1000;
  const summary = { scanned_activities: 0, due_activities: 0, sent: 0, failed: 0, skipped_unparsable: 0 };

  let activities = [];
  try {
    const res = await db.collection('activities')
      .where({ status: _.neq('cancelled') })
      .orderBy('start_time', 'asc')
      .limit(100)
      .get();
    activities = res.data || [];
  } catch (error) {
    if (isCollectionMissing(error)) return ok(summary, '无活动');
    return fail('扫描活动失败: ' + error.message);
  }
  summary.scanned_activities = activities.length;

  for (const act of activities) {
    if (summary.sent >= REMIND_MAX_PER_RUN) break;

    const startTs = parseWallClockTs(act.start_time);
    if (Number.isNaN(startTs)) { summary.skipped_unparsable += 1; continue; }
    // 只提醒"现在 ~ 现在+N小时"内即将开始的活动
    if (!(startTs > nowTs && startTs <= windowTs)) continue;
    summary.due_activities += 1;

    let regs = [];
    try {
      const regRes = await db.collection('activity_registrations')
        .where({
          activity_id: act._id,
          status: _.nin(['cancelled', 'failed', 'processing']),
          reminder_sent: _.neq(true)
        })
        .limit(REMIND_MAX_PER_RUN)
        .get();
      regs = regRes.data || [];
    } catch (error) {
      if (!isCollectionMissing(error)) console.warn('[reminder] load regs failed:', error && error.message);
      continue;
    }
    if (regs.length === 0) continue;

    const openidMap = await mapUserOpenids(regs.map(r => r.user_id));
    const timeText = formatWallClock(startTs);

    for (const reg of regs) {
      if (summary.sent >= REMIND_MAX_PER_RUN) break;
      const touser = openidMap[reg.user_id];
      if (!touser) continue;

      const sent = await sendSubscribeMessage(touser, ACTIVITY_REMINDER_TMPL, {
        thing9: { value: asThing(act.title || '活动', 20) },
        time2: { value: timeText },
        thing4: { value: asThing(act.location || '待定', 20) },
        thing5: { value: asThing('活动即将开始，请准时参加', 20) }
      }, 'pages/activity/index');

      if (sent) {
        summary.sent += 1;
        try {
          await db.collection('activity_registrations').doc(reg._id).update({
            data: { reminder_sent: true, reminder_sent_at: db.serverDate(), updated_at: db.serverDate() }
          });
        } catch (e) { console.warn('[reminder] mark sent failed:', e && e.message); }
      } else {
        summary.failed += 1;
      }
    }
  }

  return ok(summary, '提醒任务完成');
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
      .where({ user_id: user._id, activity_id })
      .limit(10)
      .get();
    return (res.data || []).find(item => !['cancelled', 'failed'].includes(item.status)) || null;
  } catch (error) {
    if (isCollectionMissing(error)) return null;
    throw error;
  }
}

async function getUserRegistrationsMap(user_id, activity_ids) {
  if (!user_id || !activity_ids || activity_ids.length === 0) return new Map();
  try {
    const res = await db.collection('activity_registrations')
      .where({ user_id, activity_id: _.in(activity_ids) })
      .limit(activity_ids.length)
      .get();
    const map = new Map();
    for (const item of res.data || []) {
      if (!['cancelled', 'failed'].includes(item.status)) {
        map.set(item.activity_id, normalizeRegistration(item));
      }
    }
    return map;
  } catch (error) {
    if (isCollectionMissing(error)) return new Map();
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
      const regMap = await getUserRegistrationsMap(user._id, list.map(item => item.activity_id).filter(Boolean));
      list.forEach(activity => {
        const reg = regMap.get(activity.activity_id) || null;
        activity.user_registration = reg;
        activity.is_registered = !!reg;
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
  let registration_id = '';
  let count_incremented = false;
  let lock_ready = false;
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
    const existing_registration = await getActiveRegistration(user, activity_id);
    if (existing_registration) {
      if (existing_registration.status === 'registered') {
        return ok({ registration_id: existing_registration.registration_id || existing_registration._id, idempotent: true }, '报名成功');
      }
      return fail('报名请求正在处理中，请稍后刷新', 'REQUEST_PROCESSING');
    }

    const cancel_deadline = toDate(activity.cancel_deadline);
    if (cancel_deadline && new Date() > cancel_deadline && !confirmed) {
      return fail('当前活动报名后不可取消，请确认后再提交', 'CANCEL_CONFIRM_REQUIRED');
    }

    if (activity.capacity > 0 && activity.registered_count >= activity.capacity) {
      return fail('活动已满员');
    }

    registration_id = buildRegistrationId(user._id, activity_id);
    const lockPatch = {
      registration_id,
      user_id: user._id,
      activity_id,
      reason,
      status: 'processing',
      can_not_cancel_confirm: confirmed,
      registered_at: db.serverDate(),
      updated_at: db.serverDate()
    };
    const lockData = { _id: registration_id, ...lockPatch };

    try {
      await db.collection('activity_registrations').add({ data: lockData });
      lock_ready = true;
    } catch (error) {
      const existed = await db.collection('activity_registrations').doc(registration_id).get();
      const old = existed.data || {};
      if (old.status === 'registered') {
        return ok({ registration_id, idempotent: true }, '报名成功');
      }
      if (old.status === 'processing') {
        return fail('报名请求正在处理中，请稍后刷新', 'REQUEST_PROCESSING');
      }
      if (['cancelled', 'failed'].includes(old.status)) {
        const reuseRes = await db.collection('activity_registrations')
          .where({ _id: registration_id, status: old.status })
          .update({ data: lockPatch });
        if (!reuseRes.stats || reuseRes.stats.updated === 0) {
          return fail('报名请求正在处理中，请稍后刷新', 'REQUEST_PROCESSING');
        }
        lock_ready = true;
      } else {
        return fail('您已经报名过此活动');
      }
    }

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
      await db.collection('activity_registrations').doc(registration_id).update({
        data: { status: 'cancelled', updated_at: db.serverDate() }
      });
      return fail('活动已满员或状态已变化');
    }
    count_incremented = true;

    await db.collection('activity_registrations').doc(registration_id).update({
      data: {
        reason,
        status: 'registered',
        can_not_cancel_confirm: confirmed,
        registered_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });

    // 报名成功通知（best-effort）：仅当用户已填纯数字学号且活动时间存在时下发
    const student_id = String(user.student_id || '').trim();
    if (/^\d{4,20}$/.test(student_id) && activity.start_time) {
      await sendSubscribeMessage(wx_context.OPENID, REGISTER_SUCCESS_TMPL, {
        thing2: { value: asThing(activity.title || '活动', 20) },
        date4: { value: asThing(activity.start_time, 20) },
        number11: { value: student_id },
        thing31: { value: asThing(activity.location || '待定', 20) },
        phrase8: { value: '报名成功' }
      }, 'pages/activity/index');
    }

    return ok({ registration_id }, '报名成功');
  } catch (error) {
    if (count_incremented && registration_id) {
      try {
        await db.collection('activities').doc(event.activity_id).update({
          data: {
            registered_count: _.inc(-1),
            updated_at: db.serverDate()
          }
        });
      } catch (rollbackError) {
        console.error('回滚活动报名人数失败:', rollbackError);
      }
    }
    if (lock_ready && registration_id) {
      try {
        await db.collection('activity_registrations').doc(registration_id).update({
          data: { status: 'failed', updated_at: db.serverDate(), error_message: error.message || '报名失败' }
        });
      } catch (markError) {
        console.error('标记报名失败失败:', markError);
      }
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
  // 定时触发器：扫描即将开始的活动并下发提醒
  if (event && event.Type === 'timer') {
    return runActivityReminder();
  }

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
