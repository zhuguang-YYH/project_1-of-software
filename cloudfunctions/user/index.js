const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const INVITE_REWARD_POINTS = Math.max(0, Number(process.env.INVITE_REWARD_POINTS) || 10);

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
    student_id: String(overrides.student_id || '').trim(),
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
    student_id: user.student_id || '',
    role: user.role || 'user',
    status: user.status || 'active',
    total_points: Number(user.total_points || 0),
    available_points: Number(user.available_points || 0),
    frozen_points: Number(user.frozen_points || 0),
    used_points: Number(user.used_points || 0),
    invited_by: user.invited_by || '',
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
    last_login_at: user.last_login_at || null
  };
}

function safeIdPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
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
    student_id: event.student_id || '',
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

async function getUserById(user_id) {
  if (!user_id) return null;
  try {
    const res = await db.collection('users').doc(user_id).get();
    return res.data || null;
  } catch (error) {
    return null;
  }
}

function readPoints(user = {}, account = {}) {
  return {
    total_points: Number(account.total_points !== undefined ? account.total_points : user.total_points) || 0,
    available_points: Number(account.available_points !== undefined ? account.available_points : user.available_points) || 0,
    frozen_points: Number(account.frozen_points !== undefined ? account.frozen_points : user.frozen_points) || 0,
    used_points: Number(account.used_points !== undefined ? account.used_points : user.used_points) || 0
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
    ...points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const res = await db.collection('point_accounts').add({ data });
  return { _id: res._id, ...data };
}

async function addPoints(user, points, business_type, reason, related_id) {
  if (!user || !user._id || points <= 0) return;
  await ensurePointAccount(user);
  await db.collection('users').doc(user._id).update({
    data: {
      total_points: _.inc(points),
      available_points: _.inc(points),
      updated_at: db.serverDate()
    }
  });
  try {
    await db.collection('point_accounts').where({ user_id: user._id }).update({
      data: {
        total_points: _.inc(points),
        available_points: _.inc(points),
        updated_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
  try {
    await db.collection('points_log').add({
      data: {
        user_id: user._id,
        amount: points,
        change_amount: points,
        type: 'income',
        point_type: 'available',
        business_type,
        reason,
        related_id,
        created_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
}

async function applyInviteReward(newUser, inviter_id) {
  const inviterId = safeIdPart(inviter_id);
  if (!newUser || !newUser._id || !inviterId || inviterId === newUser._id || INVITE_REWARD_POINTS <= 0) {
    return null;
  }

  const inviter = await getUserById(inviterId);
  if (!inviter || inviter.status === 'disabled') return null;

  const reward_id = `invite_${safeIdPart(inviterId)}_${safeIdPart(newUser._id)}`.slice(0, 120);
  try {
    await db.collection('invitation_rewards').add({
      data: {
        _id: reward_id,
        inviter_id: inviterId,
        invitee_id: newUser._id,
        points: INVITE_REWARD_POINTS,
        status: 'processing',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
  } catch (error) {
    return null;
  }

  await Promise.all([
    addPoints(inviter, INVITE_REWARD_POINTS, 'invite_reward', '邀请新成员奖励', newUser._id),
    addPoints(newUser, INVITE_REWARD_POINTS, 'invitee_reward', '新成员受邀奖励', inviterId)
  ]);

  await db.collection('users').doc(newUser._id).update({
    data: {
      invited_by: inviterId,
      updated_at: db.serverDate()
    }
  });
  await db.collection('invitation_rewards').doc(reward_id).update({
    data: {
      status: 'completed',
      completed_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return { inviter_id: inviterId, points: INVITE_REWARD_POINTS };
}

async function user_login(event) {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const incoming = incomingProfile(event.userInfo || {});
    const inviter_id = event.inviter_id || event.inviterId || '';
    let user = await getCurrentUser(openid);
    let invite_reward = null;

    if (!user) {
      const data = buildUserFields(openid, incoming);
      const createRes = await db.collection('users').add({ data });
      user = { _id: createRes._id, ...data };
      await ensureProfileCard(user);
      invite_reward = await applyInviteReward(user, inviter_id);
      if (invite_reward) {
        user = {
          ...user,
          invited_by: invite_reward.inviter_id,
          total_points: Number(user.total_points || 0) + invite_reward.points,
          available_points: Number(user.available_points || 0) + invite_reward.points
        };
      }
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
      userInfo: sanitizeUser(user),
      invite_reward
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
    if (event.student_id !== undefined) data.student_id = String(incoming.student_id || '').trim();

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
