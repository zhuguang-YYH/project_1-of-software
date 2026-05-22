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

function normalizeInterests(interests) {
  if (Array.isArray(interests)) return interests.map(item => String(item).trim()).filter(Boolean);
  return String(interests || '').split(/[,，、\s]+/).map(item => item.trim()).filter(Boolean);
}

function buildUserFields(openid, overrides = {}) {
  return {
    openid,
    nickname: overrides.nickname || '未知用户',
    avatar_url: overrides.avatar_url || '',
    signature: overrides.signature || '',
    interests: normalizeInterests(overrides.interests),
    role: overrides.role || 'user',
    status: overrides.status || 'active',
    total_points: Number(overrides.total_points || 0),
    available_points: Number(overrides.available_points || 0),
    frozen_points: Number(overrides.frozen_points || 0),
    used_points: Number(overrides.used_points || 0),
    created_at: db.serverDate(),
    updated_at: db.serverDate(),
    last_login_at: db.serverDate()
  };
}

function sanitizeUser(user = {}) {
  const userId = user._id || user.user_id || '';
  return {
    _id: userId,
    user_id: userId,
    nickname: user.nickname || '未知用户',
    avatar_url: user.avatar_url || '',
    signature: user.signature || '',
    interests: Array.isArray(user.interests) ? user.interests : [],
    role: user.role || 'user',
    status: user.status || 'active',
    total_points: Number(user.total_points || 0),
    available_points: Number(user.available_points || 0),
    frozen_points: Number(user.frozen_points || 0),
    used_points: Number(user.used_points || 0),
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
    last_login_at: user.last_login_at || null
  };
}

function buildProfileCardFields(user, overrides = {}, isCreate = true) {
  const data = {
    user_id: user._id,
    display_name: overrides.display_name || overrides.nickname || user.nickname || '未知用户',
    campus: overrides.campus || '',
    grade: overrides.grade || '',
    major: overrides.major || '',
    interests: normalizeInterests(overrides.interests !== undefined ? overrides.interests : user.interests),
    self_intro: overrides.self_intro || overrides.signature || user.signature || '',
    favorite_works: Array.isArray(overrides.favorite_works) ? overrides.favorite_works : [],
    card_style: overrides.card_style || {},
    visibility: overrides.visibility || 'public',
    avatar_url: overrides.avatar_url || user.avatar_url || '',
    updated_at: db.serverDate()
  };

  if (isCreate) data.created_at = db.serverDate();
  return data;
}

async function ensureProfileCard(user, overrides = {}) {
  if (!user || !user._id) return null;

  try {
    const res = await db.collection('profile_cards').where({ user_id: user._id }).limit(1).get();

    if (res.data.length > 0) {
      const data = buildProfileCardFields(user, {
        ...res.data[0],
        ...overrides
      }, false);
      await db.collection('profile_cards').doc(res.data[0]._id).update({ data });
      return { ...res.data[0], ...data };
    }

    const data = buildProfileCardFields(user, overrides, true);
    const addRes = await db.collection('profile_cards').add({ data });
    return { _id: addRes._id, ...data };
  } catch (error) {
    if (isCollectionMissing(error)) return null;
    throw error;
  }
}

function incomingProfile(event = {}) {
  return {
    nickname: event.nickname || '',
    avatar_url: event.avatar_url || '',
    signature: event.signature || '',
    interests: event.interests,
    campus: event.campus || '',
    grade: event.grade || '',
    major: event.major || '',
    favorite_works: event.favorite_works || event.favoriteWorks || [],
    visibility: event.visibility || 'public'
  };
}

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function user_login(event) {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const incoming = incomingProfile(event.userInfo || {});
    let user = await getCurrentUser(openid);

    if (!user) {
      const data = buildUserFields(openid, incoming);
      const createRes = await db.collection('users').add({ data });
      user = { _id: createRes._id, ...data };
      await ensureProfileCard(user);
    } else {
      const data = {
        last_login_at: db.serverDate(),
        updated_at: db.serverDate()
      };

      if (!user.nickname) data.nickname = incoming.nickname || '未知用户';
      if (!user.avatar_url && incoming.avatar_url) data.avatar_url = incoming.avatar_url;
      if (!user.role) data.role = 'user';
      if (!user.status) data.status = 'active';
      if (user.total_points === undefined) data.total_points = 0;
      if (user.available_points === undefined) data.available_points = 0;
      if (user.frozen_points === undefined) data.frozen_points = 0;
      if (user.used_points === undefined) data.used_points = 0;

      await db.collection('users').doc(user._id).update({ data });
      user = { ...user, ...data };
      await ensureProfileCard(user);
    }

    return ok({
      user_id: user._id,
      userInfo: sanitizeUser(user)
    }, '登录成功');
  } catch (error) {
    return fail('登录失败: ' + error.message);
  }
}

async function user_getUserInfo() {
  try {
    const wxContext = cloud.getWXContext();
    const user = await getCurrentUser(wxContext.OPENID);
    if (!user) return fail('用户不存在', 'USER_NOT_FOUND');
    return ok(sanitizeUser(user), '获取成功');
  } catch (error) {
    return fail('获取用户信息失败: ' + error.message);
  }
}

async function user_updateProfile(event) {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const incoming = incomingProfile(event);
    let user = await getCurrentUser(openid);

    if (!user) {
      const data = buildUserFields(openid, incoming);
      const createRes = await db.collection('users').add({ data });
      user = { _id: createRes._id, ...data };
    }

    const data = { updated_at: db.serverDate() };
    if (incoming.nickname) data.nickname = incoming.nickname;
    if (incoming.avatar_url) data.avatar_url = incoming.avatar_url;
    if (event.signature !== undefined) data.signature = incoming.signature;
    if (event.interests !== undefined) data.interests = normalizeInterests(incoming.interests);

    await db.collection('users').doc(user._id).update({ data });
    user = { ...user, ...data };
    await ensureProfileCard(user, {
      display_name: user.nickname,
      avatar_url: user.avatar_url,
      self_intro: user.signature,
      interests: user.interests,
      campus: incoming.campus,
      grade: incoming.grade,
      major: incoming.major,
      favorite_works: incoming.favorite_works,
      visibility: incoming.visibility
    });

    return ok(sanitizeUser(user), '更新成功');
  } catch (error) {
    return fail('更新失败: ' + error.message);
  }
}

async function user_logout() {
  return ok(null, '退出成功');
}

exports.main = async (event, context) => {
  const { action = 'login', ...data } = event || {};
  const actions = {
    login: user_login,
    getUserInfo: user_getUserInfo,
    updateProfile: user_updateProfile,
    logout: user_logout
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作: ${action}`);
  return handler({ ...data }, context);
};
