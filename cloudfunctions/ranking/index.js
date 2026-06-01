const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function ok(data = null, message = 'success') {
  return { code: 0, data, message };
}

function fail(message, code = -1) {
  return { code, message };
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isCollectionMissing(error) {
  return error && (
    error.errCode === -502005 ||
    String(error.message || '').includes('not exist') ||
    String(error.message || '').includes('collection not exists')
  );
}

function normalizeRankUser(user = {}, rank_no = 0) {
  return {
    user_id: user._id || user.user_id || '',
    rank_no,
    nickname: user.nickname || 'Detective',
    avatar_url: user.avatar_url || '',
    total_points: toNumber(user.total_points)
  };
}

function applyTieRanks(users = [], offset = 0) {
  let previous_score = null;
  let previous_rank = offset;

  return users.map((user, index) => {
    const score = toNumber(user.total_points);
    const rank_no = score === previous_score ? previous_rank : offset + index + 1;
    previous_score = score;
    previous_rank = rank_no;
    return normalizeRankUser(user, rank_no);
  });
}

async function writeRankingSnapshots(list) {
  const ranking_date = todayString();

  await Promise.all(list.map(async item => {
    if (!item.user_id) return;
    try {
      const data = {
        ranking_date,
        user_id: item.user_id,
        rank_no: item.rank_no,
        total_points: item.total_points,
        is_top100: item.rank_no <= 100,
        created_at: db.serverDate()
      };

      const existed = await db.collection('ranking_snapshots')
        .where({ ranking_date, user_id: item.user_id })
        .limit(1)
        .get();

      if (existed.data.length > 0) {
        await db.collection('ranking_snapshots').doc(existed.data[0]._id).update({ data });
      } else {
        const res = await db.collection('ranking_snapshots').add({ data });
        await db.collection('ranking_snapshots').doc(res._id).update({
          data: { snapshot_id: res._id }
        });
      }
    } catch (error) {
      if (!isCollectionMissing(error)) console.warn('Write ranking snapshot skipped:', error.message);
    }
  }));
}

async function getRankedUsers(limit = 100, skip = 0) {
  const res = await db.collection('users')
    .orderBy('total_points', 'desc')
    .skip(skip)
    .limit(limit)
    .get();

  return res.data || [];
}

async function ranking_getTopThree() {
  try {
    const list = applyTieRanks(await getRankedUsers(3));
    await writeRankingSnapshots(list);
    return ok(list);
  } catch (error) {
    return fail('get top three failed: ' + error.message);
  }
}

async function ranking_getFullRanking(event) {
  try {
    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(100, Math.max(1, Number(event.page_size) || 20));
    const skip = (page - 1) * page_size;
    const fetch_size = page === 1 && page_size >= 100 ? 200 : page_size;
    const users = await getRankedUsers(fetch_size, skip);
    const count_res = await db.collection('users').count();
    let source = users;

    if (page === 1 && page_size >= 100 && source.length > 100) {
      const cutoff_points = toNumber(source[99].total_points);
      source = source.filter((user, index) => (
        index < 100 || toNumber(user.total_points) === cutoff_points
      ));
    } else {
      source = source.slice(0, page_size);
    }

    const list = applyTieRanks(source, skip);
    await writeRankingSnapshots(list);
    return ok({
      list,
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    });
  } catch (error) {
    return fail('get full ranking failed: ' + error.message);
  }
}

async function ranking_getUserRanking() {
  try {
    const wx_context = cloud.getWXContext();
    const user_res = await db.collection('users')
      .where({ openid: wx_context.OPENID })
      .limit(1)
      .get();

    if (user_res.data.length === 0) return fail('user not found', 'USER_NOT_FOUND');

    const user = user_res.data[0];
    const score = toNumber(user.total_points);
    const rank_res = await db.collection('users')
      .where({ total_points: _.gt(score) })
      .count();

    return ok(normalizeRankUser(user, rank_res.total + 1));
  } catch (error) {
    return fail('get user ranking failed: ' + error.message);
  }
}

async function isAdminOrTimer(wx_context) {
  // 云函数定时触发器调用时 SOURCE 包含 "timer"，且 OPENID 为空
  const source = String(wx_context.SOURCE || '');
  if (!wx_context.OPENID && source.indexOf('timer') >= 0) return true;
  if (!wx_context.OPENID) return false;
  const res = await db.collection('users').where({ openid: wx_context.OPENID }).limit(1).get();
  const user = res.data[0];
  if (user && user.role === 'admin') return true;
  const bootstrap = String(process.env.BOOTSTRAP_ADMIN_OPENID || '').trim();
  return Boolean(bootstrap && bootstrap === wx_context.OPENID);
}

async function ranking_generateSnapshot() {
  try {
    const wx_context = cloud.getWXContext();
    const allowed = await isAdminOrTimer(wx_context);
    if (!allowed) return fail('permission denied', 'PERMISSION_DENIED');
    const list = applyTieRanks(await getRankedUsers(100));
    await writeRankingSnapshots(list);
    return ok({ count: list.length, ranking_date: todayString() });
  } catch (error) {
    return fail('generate snapshot failed: ' + error.message);
  }
}

async function ranking_getStats() {
  try {
    const count_res = await db.collection('users').count();
    const top_res = await db.collection('users').orderBy('total_points', 'desc').limit(1).get();
    return ok({
      user_count: count_res.total,
      highest_points: top_res.data.length > 0 ? toNumber(top_res.data[0].total_points) : 0
    });
  } catch (error) {
    return fail('get ranking stats failed: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getTopThree', ...data } = event || {};
  const actions = {
    getTopThree: ranking_getTopThree,
    getFullRanking: ranking_getFullRanking,
    getUserRanking: ranking_getUserRanking,
    generateSnapshot: ranking_generateSnapshot,
    getStats: ranking_getStats
  };

  const handler = actions[action];
  if (!handler) return fail(`unknown action: ${action}`);
  return handler(data, context);
};
