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

function normalizeInterests(interests) {
  if (Array.isArray(interests)) return interests.map(item => String(item).trim()).filter(Boolean);
  return String(interests || '').split(/[,，、\s]+/).map(item => item.trim()).filter(Boolean);
}

function isCollectionMissing(error) {
  return error && (
    error.errCode === -502005 ||
    String(error.message || '').includes('not exist') ||
    String(error.message || '').includes('collection not exists')
  );
}

async function getCurrentUser() {
  const wxContext = cloud.getWXContext();
  const res = await db.collection('users').where({ openid: wxContext.OPENID }).limit(1).get();
  return res.data[0] || null;
}

async function getUserById(userId) {
  if (!userId) return null;
  const res = await db.collection('users').doc(userId).get();
  return res.data || null;
}

function buildDefaultCard(user) {
  return {
    user_id: user._id,
    display_name: user.nickname || '未知用户',
    campus: user.campus || '',
    grade: user.grade || '',
    major: user.major || '',
    interests: normalizeInterests(user.interests),
    self_intro: user.signature || '',
    favorite_works: Array.isArray(user.favorite_works) ? user.favorite_works : [],
    card_style: user.card_style || {},
    visibility: user.visibility || 'public',
    avatar_url: user.avatar_url || '',
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
}

async function getOrCreateProfileCard(user) {
  try {
    const res = await db.collection('profile_cards').where({ user_id: user._id }).limit(1).get();
    if (res.data.length > 0) return res.data[0];

    const data = buildDefaultCard(user);
    const addRes = await db.collection('profile_cards').add({ data });
    return { _id: addRes._id, ...data };
  } catch (error) {
    if (isCollectionMissing(error)) return buildDefaultCard(user);
    throw error;
  }
}

async function calcRank(score) {
  const rankRes = await db.collection('users')
    .where({ total_points: _.gt(Number(score || 0)) })
    .count();
  return rankRes.total + 1;
}

async function getPointAccount(userId) {
  try {
    const res = await db.collection('point_accounts').where({ user_id: userId }).limit(1).get();
    return res.data[0] || null;
  } catch (error) {
    if (isCollectionMissing(error)) return null;
    throw error;
  }
}

function publicCardFromUser(user, card, rankNo, account) {
  return {
    card_id: card._id || '',
    user_id: user._id,
    display_name: card.display_name || user.nickname || '未知用户',
    avatar_url: card.avatar_url || user.avatar_url || '',
    self_intro: card.self_intro || user.signature || '',
    campus: card.campus || '',
    grade: card.grade || '',
    major: card.major || '',
    interests: normalizeInterests(card.interests),
    favorite_works: Array.isArray(card.favorite_works) ? card.favorite_works : [],
    card_style: card.card_style || {},
    visibility: card.visibility || 'public',
    total_points: Number((account && account.total_points) || user.total_points || 0),
    available_points: Number((account && account.available_points) || user.available_points || 0),
    frozen_points: Number((account && account.frozen_points) || user.frozen_points || 0),
    rank_no: rankNo,
    created_at: card.created_at || user.created_at || null,
    updated_at: card.updated_at || user.updated_at || null
  };
}

async function profile_getCard() {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('用户不存在', 'USER_NOT_FOUND');

    const card = await getOrCreateProfileCard(user);
    const account = await getPointAccount(user._id);
    const rankNo = await calcRank((account && account.total_points) || user.total_points);
    return ok(publicCardFromUser(user, card, rankNo, account), '获取成功');
  } catch (error) {
    return fail('获取名片失败: ' + error.message);
  }
}

async function profile_getPublicCard(event) {
  try {
    const user = await getUserById(event.user_id);
    if (!user) return fail('用户不存在', 'USER_NOT_FOUND');

    const card = await getOrCreateProfileCard(user);
    if (card.visibility === 'hidden') return fail('该用户未公开个人名片', 'PROFILE_PRIVATE');

    const account = await getPointAccount(user._id);
    const rankNo = await calcRank((account && account.total_points) || user.total_points);
    return ok(publicCardFromUser(user, card, rankNo, account), '获取成功');
  } catch (error) {
    return fail('获取公开名片失败: ' + error.message);
  }
}

async function profile_updateCard(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('用户不存在', 'USER_NOT_FOUND');

    const card = await getOrCreateProfileCard(user);
    const data = {
      updated_at: db.serverDate()
    };

    if (event.display_name !== undefined || event.nickname !== undefined) {
      data.display_name = event.display_name || event.nickname || card.display_name || user.nickname || '未知用户';
    }
    if (event.avatar_url !== undefined) data.avatar_url = event.avatar_url || '';
    if (event.self_intro !== undefined || event.signature !== undefined) {
      data.self_intro = event.self_intro || event.signature || '';
    }
    if (event.interests !== undefined) data.interests = normalizeInterests(event.interests);
    if (event.campus !== undefined) data.campus = event.campus || '';
    if (event.grade !== undefined) data.grade = event.grade || '';
    if (event.major !== undefined) data.major = event.major || '';
    if (event.favorite_works !== undefined) {
      data.favorite_works = Array.isArray(event.favorite_works) ? event.favorite_works : normalizeInterests(event.favorite_works);
    }
    if (event.card_style !== undefined) data.card_style = event.card_style || {};
    if (event.visibility !== undefined) data.visibility = event.visibility || 'public';

    if (card._id) {
      await db.collection('profile_cards').doc(card._id).update({ data });
    }

    const userPatch = { updated_at: db.serverDate() };
    if (data.display_name !== undefined) userPatch.nickname = data.display_name;
    if (data.avatar_url !== undefined) userPatch.avatar_url = data.avatar_url;
    if (data.self_intro !== undefined) userPatch.signature = data.self_intro;
    if (data.interests !== undefined) userPatch.interests = data.interests;
    await db.collection('users').doc(user._id).update({ data: userPatch });

    return ok(null, '更新成功');
  } catch (error) {
    return fail('更新名片失败: ' + error.message);
  }
}

async function profile_getMyPoints() {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('用户不存在', 'USER_NOT_FOUND');

    const account = await getPointAccount(user._id);
    return ok({
      total_points: Number((account && account.total_points) || user.total_points || 0),
      available_points: Number((account && account.available_points) || user.available_points || 0),
      frozen_points: Number((account && account.frozen_points) || user.frozen_points || 0)
    }, '获取成功');
  } catch (error) {
    return fail('获取积分失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getCard', ...data } = event || {};
  const actions = {
    getCard: profile_getCard,
    getPublicCard: profile_getPublicCard,
    updateCard: profile_updateCard,
    getMyPoints: profile_getMyPoints
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作: ${action}`);
  return handler({ ...data }, context);
};
