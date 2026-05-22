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

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getCommissionId(event = {}) {
  return event.commission_id || '';
}

function getAcceptanceId(event = {}) {
  return event.acceptance_id || '';
}

function isExpired(deadline) {
  if (!deadline) return false;
  const time = new Date(deadline).getTime();
  return !Number.isNaN(time) && Date.now() > time;
}

function isAdminUser(user = {}) {
  return String(user.role || '').toLowerCase() === 'admin';
}

async function getCurrentUser() {
  const wxContext = cloud.getWXContext();
  const res = await db.collection('users').where({ openid: wxContext.OPENID }).limit(1).get();
  return res.data[0] || null;
}

async function getUserById(userId) {
  if (!userId) return null;
  try {
    const res = await db.collection('users').doc(userId).get();
    return res.data || null;
  } catch (error) {
    return null;
  }
}

function readPoints(user = {}, account = {}) {
  return {
    total_points: toNumber(account.total_points !== undefined ? account.total_points : user.total_points),
    available_points: toNumber(account.available_points !== undefined ? account.available_points : user.available_points),
    frozen_points: toNumber(account.frozen_points !== undefined ? account.frozen_points : user.frozen_points),
    used_points: toNumber(account.used_points !== undefined ? account.used_points : user.used_points)
  };
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
    total_points: points.total_points,
    available_points: points.available_points,
    frozen_points: points.frozen_points,
    used_points: points.used_points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const addRes = await db.collection('point_accounts').add({ data });
  return { _id: addRes._id, ...data };
}

async function syncPoints(user, nextPoints) {
  const account = await ensurePointAccount(user);
  const data = {
    total_points: Math.max(0, toNumber(nextPoints.total_points)),
    available_points: Math.max(0, toNumber(nextPoints.available_points)),
    frozen_points: Math.max(0, toNumber(nextPoints.frozen_points)),
    used_points: Math.max(0, toNumber(nextPoints.used_points)),
    updated_at: db.serverDate()
  };
  await db.collection('users').doc(user._id).update({ data });
  await db.collection('point_accounts').doc(account._id).update({ data });
}

async function addPointLog(userId, data) {
  try {
    await db.collection('points_log').add({
      data: {
        user_id: userId,
        amount: data.amount,
        change_amount: data.amount,
        type: data.type,
        point_type: data.point_type,
        business_type: data.business_type,
        related_id: data.related_id,
        reason: data.reason,
        description: data.reason,
        created_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
}

function publicCommission(item = {}, currentUserId = '') {
  const id = item.commission_id || item._id || '';
  const reward = toNumber(item.reward_points);
  const remaining = item.remaining_reward !== undefined ? toNumber(item.remaining_reward) : reward;

  return {
    id,
    commission_id: id,
    publisher_id: item.publisher_id || '',
    publisher_name: item.publisher_name || '匿名侦探',
    title: item.title || '',
    content: item.content || '',
    description: item.content || '',
    reward_points: reward,
    remaining_reward: remaining,
    frozen_reward: toNumber(item.frozen_reward),
    reward_source: item.reward_source || 'publisher',
    deadline: item.deadline || '',
    status: item.status || 'recruiting',
    is_pinned: item.is_pinned === true,
    accepted_count: toNumber(item.accepted_count),
    completed_count: toNumber(item.completed_count),
    resolved_at: item.resolved_at || '',
    created_at: item.created_at || '',
    updated_at: item.updated_at || '',
    is_mine: item.publisher_id === currentUserId
  };
}

function publicAcceptance(item = {}) {
  const id = item.acceptance_id || item._id || '';
  return {
    id,
    acceptance_id: id,
    commission_id: item.commission_id || '',
    receiver_id: item.receiver_id || '',
    receiver_name: item.receiver_name || '匿名侦探',
    title: item.title || '',
    publisher_id: item.publisher_id || '',
    status: item.status || 'accepted',
    reward_points: toNumber(item.reward_points),
    accepted_at: item.accepted_at || '',
    completed_at: item.completed_at || '',
    rewarded_at: item.rewarded_at || '',
    created_at: item.created_at || '',
    updated_at: item.updated_at || ''
  };
}

async function getCommissionWithMeta(commission, currentUser) {
  const item = publicCommission(commission, currentUser && currentUser._id);
  let my_acceptance = null;

  if (currentUser && currentUser._id) {
    try {
      const res = await db.collection('commission_acceptances')
        .where({
          commission_id: item.commission_id,
          receiver_id: currentUser._id,
          status: _.neq('withdrawn')
        })
        .limit(1)
        .get();
      if (res.data.length > 0) my_acceptance = publicAcceptance(res.data[0]);
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }
  }

  return { ...item, my_acceptance };
}

async function commission_getCommissions(event) {
  try {
    const currentUser = await getCurrentUser();
    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(50, Math.max(1, Number(event.page_size) || 10));
    const skip = (page - 1) * page_size;
    const where = { status: _.in(['recruiting', 'in_progress']) };

    const res = await db.collection('commissions')
      .where(where)
      .orderBy('is_pinned', 'desc')
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();
    const countRes = await db.collection('commissions').where(where).count();
    const list = await Promise.all((res.data || []).map(item => getCommissionWithMeta(item, currentUser)));

    return ok({ list, total: countRes.total, page, page_size }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ list: [], total: 0, page: 1, page_size: 10 }, '获取成功');
    return fail('获取委托失败: ' + error.message);
  }
}

async function commission_getCommissionDetail(event) {
  try {
    const currentUser = await getCurrentUser();
    const commissionId = getCommissionId(event);
    if (!commissionId) return fail('委托编号不能为空');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const acceptanceRes = await db.collection('commission_acceptances')
      .where({ commission_id: commissionId })
      .orderBy('created_at', 'desc')
      .get();

    return ok({
      commission: await getCommissionWithMeta(commRes.data || {}, currentUser),
      acceptances: (acceptanceRes.data || []).map(publicAcceptance)
    }, '获取成功');
  } catch (error) {
    return fail('获取委托详情失败: ' + error.message);
  }
}

async function commission_publishCommission(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');

    const title = String(event.title || '').trim();
    const content = String(event.content || event.description || '').trim();
    const reward = Number(event.reward_points || event.reward || 0);
    const isPinned = event.is_pinned === true || event.isPinned === true;
    const officialReward = isPinned && isAdminUser(user);

    if (!title) return fail('委托标题不能为空');
    if (!content) return fail('委托内容不能为空');
    if (!Number.isInteger(reward) || reward <= 0) return fail('奖励积分必须为正整数');

    const points = readPoints(user, await ensurePointAccount(user));
    if (!officialReward && points.available_points < reward) {
      return fail('可兑换积分不足，无法发布委托');
    }

    if (!officialReward) {
      await syncPoints(user, {
        ...points,
        available_points: points.available_points - reward,
        frozen_points: points.frozen_points + reward
      });
    }

    const data = {
      publisher_id: user._id,
      publisher_name: user.nickname || '匿名侦探',
      title,
      content,
      reward_points: reward,
      remaining_reward: reward,
      frozen_reward: officialReward ? 0 : reward,
      reward_source: officialReward ? 'official' : 'publisher',
      deadline: event.deadline || '',
      status: 'recruiting',
      is_pinned: officialReward,
      accepted_count: 0,
      completed_count: 0,
      resolved_at: '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };

    const res = await db.collection('commissions').add({ data });
    await db.collection('commissions').doc(res._id).update({ data: { commission_id: res._id } });

    if (!officialReward) {
      await addPointLog(user._id, {
        amount: reward,
        type: 'freeze',
        point_type: 'frozen',
        business_type: 'commission_freeze',
        related_id: res._id,
        reason: `发布委托冻结积分 - ${title}`
      });
    }

    return ok({ commission_id: res._id }, '发布成功');
  } catch (error) {
    return fail('发布失败: ' + error.message);
  }
}

async function commission_acceptCommission(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');

    const commissionId = getCommissionId(event);
    if (!commissionId) return fail('委托编号不能为空');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const commission = commRes.data || {};
    if (!commission._id && !commission.commission_id) return fail('委托不存在');
    if (commission.publisher_id === user._id) return fail('不能领取自己发布的委托');
    if (!['recruiting', 'in_progress'].includes(commission.status)) return fail('该委托当前不可领取');
    if (isExpired(commission.deadline)) return fail('该委托已超过截止时间');

    const existRes = await db.collection('commission_acceptances')
      .where({
        commission_id: commission.commission_id || commissionId,
        receiver_id: user._id,
        status: _.neq('withdrawn')
      })
      .limit(1)
      .get();
    if (existRes.data.length > 0) return fail('你已领取过该委托');

    const data = {
      commission_id: commission.commission_id || commissionId,
      receiver_id: user._id,
      receiver_name: user.nickname || '匿名侦探',
      title: commission.title || '',
      publisher_id: commission.publisher_id || '',
      status: 'accepted',
      reward_points: 0,
      accepted_at: db.serverDate(),
      completed_at: '',
      rewarded_at: '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };

    const res = await db.collection('commission_acceptances').add({ data });
    await db.collection('commission_acceptances').doc(res._id).update({ data: { acceptance_id: res._id } });
    await db.collection('commissions').doc(commission.commission_id || commissionId).update({
      data: {
        status: 'in_progress',
        accepted_count: _.inc(1),
        updated_at: db.serverDate()
      }
    });

    return ok({ acceptance_id: res._id }, '领取成功');
  } catch (error) {
    return fail('领取失败: ' + error.message);
  }
}

async function commission_completeCommission(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');

    const acceptanceId = getAcceptanceId(event);
    if (!acceptanceId) return fail('领取记录编号不能为空');

    const accRes = await db.collection('commission_acceptances').doc(acceptanceId).get();
    const acceptance = accRes.data || {};
    if (!acceptance._id && !acceptance.acceptance_id) return fail('领取记录不存在');
    if (acceptance.receiver_id !== user._id) return fail('只能完成自己领取的委托');
    if (acceptance.status !== 'accepted') return fail('该委托状态不可标记完成');

    await db.collection('commission_acceptances').doc(acceptanceId).update({
      data: {
        status: 'completed',
        completed_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    await db.collection('commissions').doc(acceptance.commission_id).update({
      data: {
        completed_count: _.inc(1),
        updated_at: db.serverDate()
      }
    });

    return ok(null, '已提交完成，等待发布者确认');
  } catch (error) {
    return fail('完成失败: ' + error.message);
  }
}

async function commission_allocateRewards(event) {
  try {
    const publisher = await getCurrentUser();
    if (!publisher) return fail('请先登录', 'USER_NOT_FOUND');

    const commissionId = getCommissionId(event);
    const acceptanceId = getAcceptanceId(event);
    const points = Number(event.allocated_points || event.points || 0);

    if (!commissionId || !acceptanceId) return fail('委托和领取记录不能为空');
    if (!Number.isInteger(points) || points <= 0) return fail('分配积分必须为正整数');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const commission = commRes.data || {};
    if (!commission._id && !commission.commission_id) return fail('委托不存在');
    if (commission.publisher_id !== publisher._id) return fail('只有发布者可以分配奖励');

    const remainingReward = toNumber(commission.remaining_reward);
    if (points > remainingReward) return fail('分配积分不能超过剩余奖励');

    const accRes = await db.collection('commission_acceptances').doc(acceptanceId).get();
    const acceptance = accRes.data || {};
    if ((!acceptance._id && !acceptance.acceptance_id) || acceptance.commission_id !== (commission.commission_id || commissionId)) {
      return fail('领取记录不存在');
    }
    if (acceptance.status !== 'completed') return fail('只能给已完成的领取记录分配奖励');

    const receiver = await getUserById(acceptance.receiver_id);
    if (!receiver) return fail('领取者信息不存在');

    const receiverPoints = readPoints(receiver, await ensurePointAccount(receiver));
    await syncPoints(receiver, {
      ...receiverPoints,
      total_points: receiverPoints.total_points + points,
      available_points: receiverPoints.available_points + points
    });

    const officialReward = commission.reward_source === 'official';
    if (!officialReward) {
      const publisherPoints = readPoints(publisher, await ensurePointAccount(publisher));
      await syncPoints(publisher, {
        ...publisherPoints,
        frozen_points: Math.max(0, publisherPoints.frozen_points - points),
        used_points: publisherPoints.used_points + points
      });
    }

    await db.collection('commission_acceptances').doc(acceptanceId).update({
      data: {
        status: 'rewarded',
        reward_points: points,
        rewarded_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });

    const nextRemainingReward = remainingReward - points;
    await db.collection('commissions').doc(commission.commission_id || commissionId).update({
      data: {
        remaining_reward: nextRemainingReward,
        frozen_reward: officialReward ? 0 : Math.max(0, toNumber(commission.frozen_reward) - points),
        status: nextRemainingReward <= 0 ? 'resolved' : commission.status,
        resolved_at: nextRemainingReward <= 0 ? db.serverDate() : commission.resolved_at,
        updated_at: db.serverDate()
      }
    });

    const allocationRes = await db.collection('commission_allocations').add({
      data: {
        commission_id: commission.commission_id || commissionId,
        acceptance_id: acceptanceId,
        receiver_id: acceptance.receiver_id,
        allocated_points: points,
        created_at: db.serverDate()
      }
    });
    await db.collection('commission_allocations').doc(allocationRes._id).update({
      data: { allocation_id: allocationRes._id }
    });

    await addPointLog(receiver._id, {
      amount: points,
      type: 'income',
      point_type: 'available',
      business_type: officialReward ? 'official_commission_reward' : 'commission_reward',
      related_id: commission.commission_id || commissionId,
      reason: `委托奖励 - ${commission.title || ''}`
    });

    return ok({ remaining_reward: nextRemainingReward }, '奖励分配成功');
  } catch (error) {
    return fail('分配失败: ' + error.message);
  }
}

async function commission_getMyCommissions(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return ok({ published: [], accepted: [], page: 1, page_size: 20 }, '获取成功');

    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(50, Math.max(1, Number(event.page_size) || 20));
    const skip = (page - 1) * page_size;

    const publishedRes = await db.collection('commissions')
      .where({ publisher_id: user._id })
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();

    const acceptedRes = await db.collection('commission_acceptances')
      .where({ receiver_id: user._id })
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();

    const published = await Promise.all((publishedRes.data || []).map(async item => {
      const commission = publicCommission(item, user._id);
      const accRes = await db.collection('commission_acceptances')
        .where({ commission_id: commission.commission_id })
        .orderBy('created_at', 'desc')
        .get();
      return {
        ...commission,
        acceptances: (accRes.data || []).map(publicAcceptance)
      };
    }));

    const accepted = await Promise.all((acceptedRes.data || []).map(async item => {
      const acceptance = publicAcceptance(item);
      let commission = null;
      try {
        const commRes = await db.collection('commissions').doc(acceptance.commission_id).get();
        commission = publicCommission(commRes.data || {}, user._id);
      } catch (error) {
        commission = null;
      }
      return { ...acceptance, commission };
    }));

    return ok({ published, accepted, page, page_size }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ published: [], accepted: [], page: 1, page_size: 20 }, '获取成功');
    return fail('获取我的委托失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getCommissions', ...data } = event || {};
  const actions = {
    getCommissions: commission_getCommissions,
    getCommissionDetail: commission_getCommissionDetail,
    publish: commission_publishCommission,
    publishCommission: commission_publishCommission,
    accept: commission_acceptCommission,
    acceptCommission: commission_acceptCommission,
    complete: commission_completeCommission,
    completeCommission: commission_completeCommission,
    allocateRewards: commission_allocateRewards,
    getMyCommissions: commission_getMyCommissions
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作: ${action}`);
  return handler({ ...data }, context);
};
