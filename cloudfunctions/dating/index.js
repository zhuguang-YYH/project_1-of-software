const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const DAILY_SWIPE_LIMIT = 20;
const PROFILES_PER_BATCH = 5;

function success(data = null, message = '操作成功') {
  return { code: 0, data, message };
}

function fail(message = '操作失败') {
  return { code: -1, message };
}

function isCollectionMissing(error) {
  return error && (
    error.errCode === -502005 ||
    String(error.message || '').includes('not exist') ||
    String(error.message || '').includes('collection not exists')
  );
}

function todayText() {
  return new Date().toISOString().split('T')[0];
}

function numberValue(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function getCurrentUser(openid) {
  if (!openid) return null;
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function resolveUserByIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;

  try {
    const doc_res = await db.collection('users').doc(value).get();
    if (doc_res.data) return doc_res.data;
  } catch (_) { /* try compatible lookups */ }

  const userFields = ['user_id', 'openid'];
  for (const field of userFields) {
    try {
      const res = await db.collection('users')
        .where({ [field]: value })
        .limit(1)
        .get();
      if (res.data && res.data[0]) return res.data[0];
    } catch (_) { /* try next user field */ }
  }

  const cardFields = ['card_id', 'user_id'];
  for (const field of cardFields) {
    try {
      const card_res = await db.collection('profile_cards')
        .where({ [field]: value })
        .limit(1)
        .get();
      const card = card_res.data && card_res.data[0];
      if (card && card.user_id && card.user_id !== value) {
        return resolveUserByIdentifier(card.user_id);
      }
    } catch (_) { /* try next card field */ }
  }

  try {
    const card_doc_res = await db.collection('profile_cards').doc(value).get();
    const card = card_doc_res.data;
    if (card && card.user_id && card.user_id !== value) {
      return resolveUserByIdentifier(card.user_id);
    }
  } catch (_) { /* ignore */ }

  return null;
}

function buildMatchId(user_id_1, user_id_2) {
  const ids = [user_id_1, user_id_2].sort();
  return `match_${ids[0]}_${ids[1]}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}

function buildInvitationId(from_user_id, to_user_id) {
  const ts = Date.now();
  const ids = [from_user_id, to_user_id].sort();
  return `inv_${ids[0]}_${ids[1]}_${ts}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}

function buildMessageId() {
  const ts = Date.now();
  // 使用更长的随机串降低碰撞概率
  const rnd = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
  return `msg_${ts}_${rnd}`.slice(0, 64);
}

// 预设游戏类型
function safeIdPart(value, max = 28) {
  return String(value || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, max);
}

const GAME_TYPES = ['script_kill', 'board_game', 'puzzle', 'activity', 'other'];
const GAME_TYPE_LABELS = {
  script_kill: '剧本杀',
  board_game: '桌游',
  puzzle: '解谜',
  activity: '活动',
  other: '其他'
};

// ========== Actions ==========

// 获取今日状态
async function dating_getDailyStatus() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const today = todayText();

    // 今日已滑动次数
    let today_swipes = 0;
    try {
      const swipe_res = await db.collection('dating_swipes')
        .where({ user_id: user._id, swipe_date: today })
        .count();
      today_swipes = swipe_res.total || 0;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 是否在交友池
    let pool_entry = null;
    try {
      const pool_res = await db.collection('dating_pool')
        .where({ user_id: user._id })
        .limit(1)
        .get();
      pool_entry = pool_res.data[0] || null;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 交友偏好
    let preferences = null;
    try {
      const pref_res = await db.collection('dating_preferences')
        .where({ user_id: user._id })
        .limit(1)
        .get();
      preferences = pref_res.data[0] || null;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    return success({
      remaining_swipes: Math.max(0, DAILY_SWIPE_LIMIT - today_swipes),
      today_swipes,
      daily_limit: DAILY_SWIPE_LIMIT,
      is_in_pool: !!(pool_entry && pool_entry.is_active),
      preferences: preferences ? {
        dating_visibility: !!preferences.dating_visibility,
        interested_tags: preferences.interested_tags || [],
        campus_preference: preferences.campus_preference || 'any',
        grade_preference: preferences.grade_preference || 'any'
      } : null
    }, '获取成功');
  } catch (error) {
    return fail('获取状态失败: ' + error.message);
  }
}

// 获取推荐用户列表
async function dating_getProfiles() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const today = todayText();

    // 检查今日限额
    let today_swipes = 0;
    try {
      const swipe_res = await db.collection('dating_swipes')
        .where({ user_id: user._id, swipe_date: today })
        .count();
      today_swipes = swipe_res.total || 0;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }
    if (today_swipes >= DAILY_SWIPE_LIMIT) {
      return success({ profiles: [], remaining_swipes: 0, daily_limit: DAILY_SWIPE_LIMIT }, '今日浏览已达上限');
    }

    // 获取已滑动过的用户ID
    const swiped_ids = new Set();
    try {
      const swiped_res = await db.collection('dating_swipes')
        .where({ user_id: user._id, swipe_date: today })
        .limit(DAILY_SWIPE_LIMIT)
        .get();
      (swiped_res.data || []).forEach(s => swiped_ids.add(s.target_user_id));
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 获取pass过当前用户的用户ID（避免骚扰）
    const passed_me_ids = new Set();
    try {
      const passed_res = await db.collection('dating_swipes')
        .where({ target_user_id: user._id, action: 'pass' })
        .limit(200)
        .get();
      (passed_res.data || []).forEach(s => passed_me_ids.add(s.user_id));
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 从交友池获取候选用户
    const excluded = new Set([user._id, ...swiped_ids, ...passed_me_ids]);
    let pool = [];
    try {
      const pool_res = await db.collection('dating_pool')
        .where({
          is_active: true,
          user_id: _.nin([...excluded].slice(0, 100))
        })
        .limit(50)
        .get();
      pool = pool_res.data || [];
    } catch (error) {
      if (isCollectionMissing(error)) return success({ profiles: [], remaining_swipes: Math.max(0, DAILY_SWIPE_LIMIT - today_swipes) });
      throw error;
    }

    if (pool.length === 0) {
      return success({
        profiles: [],
        remaining_swipes: Math.max(0, DAILY_SWIPE_LIMIT - today_swipes),
        daily_limit: DAILY_SWIPE_LIMIT
      }, '暂无可推荐的用户');
    }

    // 获取当前用户偏好和名片
    let preferences = null;
    try {
      const pref_res = await db.collection('dating_preferences')
        .where({ user_id: user._id })
        .limit(1)
        .get();
      preferences = pref_res.data[0] || null;
    } catch (_) { /* ignore */ }

    // 获取当前用户的信息（用于 campus/grade 比较）
    let my_card = {};
    try {
      const my_card_res = await db.collection('profile_cards')
        .where({ user_id: user._id })
        .limit(1)
        .get();
      my_card = my_card_res.data[0] || {};
    } catch (_) { /* ignore */ }

    const current_interests = pool.find(p => p.user_id === user._id)?.interests || [];
    const my_campus = my_card.campus || '';
    const my_grade = my_card.grade || '';

    // 获取候选用户的 puzzle 统计（正确率）
    const candidate_ids = pool.map(p => p.user_id);
    const stats_map = {};
    try {
      const answers_res = await db.collection('puzzle_answers')
        .where({ user_id: _.in(candidate_ids) })
        .limit(500)
        .get();
      const user_stats = {};
      (answers_res.data || []).forEach(a => {
        if (!user_stats[a.user_id]) user_stats[a.user_id] = { total: 0, correct: 0 };
        user_stats[a.user_id].total += 1;
        if (a.is_correct) user_stats[a.user_id].correct += 1;
      });
      Object.keys(user_stats).forEach(uid => {
        const s = user_stats[uid];
        stats_map[uid] = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 50;
      });
    } catch (error) {
      if (!isCollectionMissing(error)) console.warn('[dating] load puzzle stats failed:', error.message);
    }

    // 获取用户公开名片
    const card_map = {};
    try {
      const cards_res = await db.collection('profile_cards')
        .where({ user_id: _.in(candidate_ids) })
        .get();
      (cards_res.data || []).forEach(c => { card_map[c.user_id] = c; });
    } catch (error) {
      if (!isCollectionMissing(error)) console.warn('[dating] load profile cards failed:', error.message);
    }

    // 获取用户基本信息
    const users_map = {};
    try {
      const users_res = await db.collection('users')
        .where({ _id: _.in(candidate_ids) })
        .field({ _id: true, nickname: true, avatar_url: true })
        .get();
      (users_res.data || []).forEach(u => { users_map[u._id] = u; });
    } catch (error) {
      if (!isCollectionMissing(error)) console.warn('[dating] load users failed:', error.message);
    }

    // 打分排序
    const scored = pool.map(candidate => {
      const card = card_map[candidate.user_id] || {};
      const candidate_interests = Array.isArray(candidate.interests)
        ? candidate.interests
        : (card.interests || []);

      let score = 0;

      // 共享兴趣 +3 per match
      const shared = candidate_interests.filter(tag => current_interests.includes(tag));
      score += shared.length * 3;

      // 同校区 +5（当前用户校区 vs 候选人校区）
      if (preferences && preferences.campus_preference === 'same' &&
          my_campus && card.campus && my_campus === card.campus) {
        score += 5;
      }

      // 同年级 +3（当前用户年级 vs 候选人年级）
      if (preferences && preferences.grade_preference === 'same' &&
          my_grade && card.grade && my_grade === card.grade) {
        score += 3;
      }

      // 谜题正确率加分 0-3
      const stats_rate = stats_map[candidate.user_id] || 50;
      if (stats_rate >= 80) score += 3;
      else if (stats_rate >= 60) score += 2;
      else if (stats_rate >= 40) score += 1;

      // 随机扰动 ±1（基于 user_id 字符串哈希的低位，避免 NaN）
      const user_id_str = String(candidate.user_id || '');
      const char_code = user_id_str.length > 3 ? user_id_str.charCodeAt(3) : user_id_str.charCodeAt(0) || 0;
      score += (char_code % 3) - 1;

      return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // 取前 N 个
    const batch = scored.slice(0, PROFILES_PER_BATCH);

    const profiles = batch.map(item => {
      const c = item.candidate;
      const card = card_map[c.user_id] || {};
      const usr = users_map[c.user_id] || {};
      const puzzle_rate = stats_map[c.user_id] || 50;
      return {
        user_id: c.user_id,
        display_name: usr.nickname || card.display_name || '神秘侦探',
        avatar_url: usr.avatar_url || card.avatar_url || '',
        campus: c.campus || card.campus || '',
        grade: c.grade || card.grade || '',
        interests: (Array.isArray(c.interests) ? c.interests : card.interests || []).slice(0, 5),
        self_intro: (card.self_intro || '').slice(0, 60),
        puzzle_correct_rate: puzzle_rate,
        shared_interests: item.candidate.interests
          ? current_interests.filter(tag => (item.candidate.interests || []).includes(tag))
          : []
      };
    });

    return success({
      profiles,
      remaining_swipes: Math.max(0, DAILY_SWIPE_LIMIT - today_swipes),
      daily_limit: DAILY_SWIPE_LIMIT
    }, '获取成功');
  } catch (error) {
    return fail('获取推荐失败: ' + error.message);
  }
}

// 滑动操作（喜欢/跳过）
async function dating_swipe(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const target_user_id = event.target_user_id;
    const action = event.swipe_action || event.business_action || event.action;
    if (!target_user_id) return fail('缺少目标用户编号');
    if (!action || !['like', 'pass'].includes(action)) return fail('操作类型错误');

    const today = todayText();

    // 检查今日限额
    let today_swipes = 0;
    try {
      const swipe_res = await db.collection('dating_swipes')
        .where({ user_id: user._id, swipe_date: today })
        .count();
      today_swipes = swipe_res.total || 0;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }
    if (today_swipes >= DAILY_SWIPE_LIMIT) return fail('今日浏览已达上限');

    // 检查是否已滑动过
    const existing = await db.collection('dating_swipes')
      .where({ user_id: user._id, target_user_id, swipe_date: today })
      .limit(1)
      .get();
    if (existing.data.length > 0) return success({ already_swiped: true }, '今天已经对这位用户操作过了');

    // 记录滑动
    await db.collection('dating_swipes').add({
      data: {
        user_id: user._id,
        target_user_id,
        action,
        swipe_date: today,
        created_at: db.serverDate()
      }
    });

    // 更新活跃时间
    try {
      await db.collection('dating_pool').where({ user_id: user._id }).update({
        data: {
          last_active_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
    } catch (_) { /* ignore */ }

    // 检测互相喜欢
    let match_created = false;
    let match_info = null;

    if (action === 'like') {
      const mutual = await db.collection('dating_swipes')
        .where({
          user_id: target_user_id,
          target_user_id: user._id,
          action: 'like'
        })
        .limit(1)
        .get();

      if (mutual.data.length > 0) {
        const match_id = buildMatchId(user._id, target_user_id);

        // 检查是否已存在match
        const existing_match = await db.collection('dating_matches')
          .where({ match_id })
          .limit(1)
          .get();

        if (existing_match.data.length === 0) {
          await db.collection('dating_matches').add({
            data: {
              match_id,
              user_id_1: [user._id, target_user_id].sort()[0],
              user_id_2: [user._id, target_user_id].sort()[1],
              matched_at: db.serverDate(),
              is_active: true,
              created_at: db.serverDate()
            }
          });
          match_created = true;

          // 获取匹配用户信息
          const target_user = await getCurrentUser((await db.collection('users').doc(target_user_id).get()).data?.openid || '');
          match_info = {
            match_id,
            matched_user_id: target_user_id,
            matched_user_name: target_user ? (target_user.nickname || '神秘侦探') : '神秘侦探'
          };
        }
      }
    }

    const remaining = Math.max(0, DAILY_SWIPE_LIMIT - today_swipes - 1);
    return success({
      action,
      remaining_swipes: remaining,
      match_created,
      match: match_info
    }, match_created ? '互相喜欢！你们配对成功了！' : (action === 'like' ? '已发送喜欢' : '已跳过'));
  } catch (error) {
    if (isCollectionMissing(error)) return fail('交友功能暂不可用');
    return fail('操作失败: ' + error.message);
  }
}

// 获取匹配列表
async function dating_getMatches() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const [as_user_1, as_user_2] = await Promise.all([
      db.collection('dating_matches')
        .where({ user_id_1: user._id, is_active: true })
        .limit(50)
        .get(),
      db.collection('dating_matches')
        .where({ user_id_2: user._id, is_active: true })
        .limit(50)
        .get()
    ]);

    const match_map = {};
    [...(as_user_1.data || []), ...(as_user_2.data || [])].forEach(match => {
      const key = match._id || match.match_id || buildMatchId(match.user_id_1, match.user_id_2);
      if (key) match_map[key] = match;
    });

    const matches_list = await Promise.all(Object.values(match_map).map(normalizeMatchRecord));
    matches_list.sort((a, b) => {
      const time_a = new Date(a.matched_at || a.created_at || 0).getTime();
      const time_b = new Date(b.matched_at || b.created_at || 0).getTime();
      return time_b - time_a;
    });

    // 收集所有对方用户 ID
    const other_ids = matches_list.map(m => m.user_id_1 === user._id ? m.user_id_2 : m.user_id_1);

    // 批量获取用户信息
    const users_map = {};
    try {
      if (other_ids.length > 0) {
        const users_res = await db.collection('users')
          .where({ _id: _.in(other_ids) })
          .field({ _id: true, nickname: true, avatar_url: true })
          .get();
        (users_res.data || []).forEach(u => { users_map[u._id] = u; });
      }
    } catch (_) { /* ignore */ }

    // 批量获取名片
    const cards_map = {};
    try {
      if (other_ids.length > 0) {
        const cards_res = await db.collection('profile_cards')
          .where({ user_id: _.in(other_ids) })
          .get();
        (cards_res.data || []).forEach(c => { cards_map[c.user_id] = c; });
      }
    } catch (_) { /* ignore */ }

    const result = [];
    for (const match of matches_list) {
      const other_id = match.user_id_1 === user._id ? match.user_id_2 : match.user_id_1;
      const usr = users_map[other_id] || {};
      const card = cards_map[other_id] || {};

      result.push({
        match_id: match.match_id,
        matched_at: match.matched_at,
        matched_user: {
          user_id: other_id,
          display_name: usr.nickname || card.display_name || '神秘侦探',
          avatar_url: usr.avatar_url || card.avatar_url || '',
          campus: card.campus || '',
          grade: card.grade || '',
          interests: card.interests || [],
          self_intro: (card.self_intro || '').slice(0, 60)
        }
      });
    }

    return success({ matches: result }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return success({ matches: [] });
    return fail('获取匹配列表失败: ' + error.message);
  }
}

// 获取匹配详情
async function dating_getMatchDetail(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const match_id = event.match_id;
    if (!match_id) return fail('缺少匹配编号');

    const match_res = await db.collection('dating_matches')
      .where({ match_id })
      .limit(1)
      .get();
    const match = match_res.data[0];
    if (!match) return fail('匹配记录不存在');

    if (match.user_id_1 !== user._id && match.user_id_2 !== user._id) {
      return fail('无权查看此匹配');
    }

    return success(match, '获取成功');
  } catch (error) {
    return fail('获取匹配详情失败: ' + error.message);
  }
}

// 更新交友偏好
async function dating_updatePreferences(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const prefs = {
      dating_visibility: event.dating_visibility !== false,
      interested_tags: Array.isArray(event.interested_tags) ? event.interested_tags : [],
      campus_preference: event.campus_preference || 'any',
      grade_preference: event.grade_preference || 'any',
      updated_at: db.serverDate()
    };

    const existing = await db.collection('dating_preferences')
      .where({ user_id: user._id })
      .limit(1)
      .get();

    if (existing.data.length > 0) {
      await db.collection('dating_preferences').doc(existing.data[0]._id).update({ data: prefs });
    } else {
      await db.collection('dating_preferences').add({
        data: {
          user_id: user._id,
          ...prefs,
          created_at: db.serverDate()
        }
      });
    }

    return success(prefs, '偏好已更新');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('偏好功能暂不可用');
    return fail('更新偏好失败: ' + error.message);
  }
}

// 加入交友池
async function dating_joinPool() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    // 获取用户资料信息
    let card = null;
    try {
      const card_res = await db.collection('profile_cards')
        .where({ user_id: user._id })
        .limit(1)
        .get();
      card = card_res.data[0] || null;
    } catch (_) { /* ignore */ }

    const pool_data = {
      user_id: user._id,
      joined_at: db.serverDate(),
      last_active_at: db.serverDate(),
      is_active: true,
      campus: (card && card.campus) || '',
      grade: (card && card.grade) || '',
      interests: (card && card.interests) || [],
      updated_at: db.serverDate()
    };

    const existing = await db.collection('dating_pool')
      .where({ user_id: user._id })
      .limit(1)
      .get();

    if (existing.data.length > 0) {
      await db.collection('dating_pool').doc(existing.data[0]._id).update({ data: pool_data });
    } else {
      await db.collection('dating_pool').add({
        data: {
          ...pool_data,
          created_at: db.serverDate()
        }
      });
    }

    // 同步更新偏好
    try {
      const pref_existing = await db.collection('dating_preferences')
        .where({ user_id: user._id })
        .limit(1)
        .get();
      if (pref_existing.data.length > 0) {
        await db.collection('dating_preferences').doc(pref_existing.data[0]._id).update({
          data: { dating_visibility: true, updated_at: db.serverDate() }
        });
      } else {
        await db.collection('dating_preferences').add({
          data: {
            user_id: user._id,
            dating_visibility: true,
            interested_tags: [],
            campus_preference: 'any',
            grade_preference: 'any',
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
      }
    } catch (_) { /* ignore */ }

    return success({ is_in_pool: true }, '已加入交友池');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('交友功能暂不可用');
    return fail('加入交友池失败: ' + error.message);
  }
}

// 退出交友池
async function dating_leavePool() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    try {
      await db.collection('dating_pool').where({ user_id: user._id }).update({
        data: { is_active: false, updated_at: db.serverDate() }
      });
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 同步更新偏好
    try {
      await db.collection('dating_preferences').where({ user_id: user._id }).update({
        data: { dating_visibility: false, updated_at: db.serverDate() }
      });
    } catch (_) { /* ignore */ }

    return success({ is_in_pool: false }, '已退出交友池');
  } catch (error) {
    return fail('退出交友池失败: ' + error.message);
  }
}

// 解除匹配
async function dating_unmatch(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const match_id = event.match_id;
    if (!match_id) return fail('缺少匹配编号');

    const match_res = await db.collection('dating_matches')
      .where({ match_id })
      .limit(1)
      .get();
    const match = match_res.data[0];
    if (!match) return fail('匹配记录不存在');
    if (match.user_id_1 !== user._id && match.user_id_2 !== user._id) return fail('无权操作');

    await db.collection('dating_matches').doc(match._id).update({
      data: { is_active: false, updated_at: db.serverDate() }
    });

    return success({}, '已解除匹配');
  } catch (error) {
    return fail('解除匹配失败: ' + error.message);
  }
}

// ========== 游戏邀请 ==========

// 发送游戏邀请
async function dating_sendInvitation(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const { to_user_id, match_id, game_type, game_name, message } = event;
    if (!to_user_id) return fail('请选择邀请对象');
    if (!game_type || !GAME_TYPES.includes(game_type)) return fail('请选择游戏类型');

    // 验证匹配关系
    const match_res = await db.collection('dating_matches')
      .where({ match_id, is_active: true })
      .limit(1)
      .get();
    const match = match_res.data[0];
    if (!match) return fail('匹配关系不存在或已解除');
    if (match.user_id_1 !== user._id && match.user_id_2 !== user._id) return fail('无权发送邀请');
    const other_id = match.user_id_1 === user._id ? match.user_id_2 : match.user_id_1;
    if (other_id !== to_user_id) return fail('邀请对象与匹配关系不符');

    // 检查是否有待处理邀请（防止重复）
    const pending = await db.collection('game_invitations')
      .where({
        from_user_id: user._id,
        to_user_id,
        status: 'pending'
      })
      .limit(1)
      .get();
    if (pending.data.length > 0) return fail('已有一条待处理邀请，请等待对方回复');

    const invitation_id = buildInvitationId(user._id, to_user_id);
    const invitation = {
      invitation_id,
      from_user_id: user._id,
      to_user_id,
      match_id,
      game_type,
      game_name: (game_name || GAME_TYPE_LABELS[game_type] || game_type).slice(0, 40),
      message: (message || '').slice(0, 200),
      status: 'pending',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };

    await db.collection('game_invitations').add({ data: invitation });

    return success({
      invitation_id,
      game_type,
      game_name: invitation.game_name,
      status: 'pending'
    }, '邀请已发送');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('邀请功能暂不可用');
    return fail('发送邀请失败: ' + error.message);
  }
}

// 获取邀请列表（收到的 + 发出的）
async function dating_getInvitations(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const filter = event.filter || 'all'; // 'received' | 'sent' | 'all'

    const conditions = [];
    if (filter === 'received') {
      conditions.push({ to_user_id: user._id });
    } else if (filter === 'sent') {
      conditions.push({ from_user_id: user._id });
    } else {
      conditions.push(_.or([{ from_user_id: user._id }, { to_user_id: user._id }]));
    }

    const res = await db.collection('game_invitations')
      .where(_.and(conditions))
      .orderBy('created_at', 'desc')
      .limit(50)
      .get();

    const invitation_list = res.data || [];

    // 收集所有对方用户 ID
    const other_ids = invitation_list.map(inv =>
      inv.from_user_id === user._id ? inv.to_user_id : inv.from_user_id
    );

    // 批量获取用户信息
    const users_map = {};
    try {
      const users_res = await db.collection('users')
        .where({ _id: _.in(other_ids) })
        .field({ _id: true, nickname: true, avatar_url: true })
        .get();
      (users_res.data || []).forEach(u => { users_map[u._id] = u; });
    } catch (_) { /* ignore */ }

    // 批量获取名片
    const cards_map = {};
    try {
      const cards_res = await db.collection('profile_cards')
        .where({ user_id: _.in(other_ids) })
        .get();
      (cards_res.data || []).forEach(c => { cards_map[c.user_id] = c; });
    } catch (_) { /* ignore */ }

    const invitations = [];
    for (const inv of invitation_list) {
      const is_sender = inv.from_user_id === user._id;
      const other_id = is_sender ? inv.to_user_id : inv.from_user_id;

      const usr = users_map[other_id] || {};
      const card = cards_map[other_id] || {};

      invitations.push({
        invitation_id: inv.invitation_id,
        match_id: inv.match_id,
        game_type: inv.game_type,
        game_name: inv.game_name,
        message: inv.message,
        status: inv.status,
        is_sender,
        created_at: inv.created_at,
        other_user: {
          user_id: other_id,
          display_name: usr.nickname || card.display_name || '神秘侦探',
          avatar_url: usr.avatar_url || card.avatar_url || ''
        }
      });
    }

    return success({ invitations }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return success({ invitations: [] });
    return fail('获取邀请列表失败: ' + error.message);
  }
}

// 响应邀请（接受/拒绝）
async function dating_respondInvitation(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const invitation_id = event.invitation_id;
    const action = event.invitation_action || event.business_action || event.action;
    if (!invitation_id) return fail('缺少邀请编号');
    if (!action || !['accept', 'decline'].includes(action)) return fail('操作类型错误');

    const inv_res = await db.collection('game_invitations')
      .where({ invitation_id })
      .limit(1)
      .get();
    const inv = inv_res.data[0];
    if (!inv) return fail('邀请记录不存在');
    if (inv.to_user_id !== user._id) return fail('无权操作此邀请');
    if (inv.status !== 'pending') return fail('该邀请已处理');

    const new_status = action === 'accept' ? 'accepted' : 'declined';
    await db.collection('game_invitations').doc(inv._id).update({
      data: {
        status: new_status,
        responded_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });

    return success({
      invitation_id,
      status: new_status
    }, action === 'accept' ? '已接受邀请，祝游戏愉快！' : '已拒绝邀请');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('邀请功能暂不可用');
    return fail('操作失败: ' + error.message);
  }
}

// ========== 好友聊天 ==========

// 发送消息（文字或游戏邀请）
async function dating_sendMessage(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const { match_id, to_user_id, content_type, content, game_data } = event;
    if (!match_id) return fail('缺少匹配编号');
    if (!to_user_id) return fail('缺少接收方编号');
    if (!content_type || !['text', 'game_invite'].includes(content_type)) return fail('消息类型错误');

    // 验证匹配关系
    const match_res = await db.collection('dating_matches')
      .where({ match_id, is_active: true })
      .limit(1)
      .get();
    const match = match_res.data[0];
    if (!match) return fail('匹配关系不存在或已解除');
    if (match.user_id_1 !== user._id && match.user_id_2 !== user._id) return fail('无权发送消息');
    const expected_to_user_id = match.user_id_1 === user._id ? match.user_id_2 : match.user_id_1;
    if (to_user_id !== expected_to_user_id) return fail('接收方与好友关系不一致');

    let final_content = '';
    let final_game_data = null;

    if (content_type === 'text') {
      final_content = String(content || '').trim().slice(0, 500);
      if (!final_content) return fail('消息内容不能为空');
    } else if (content_type === 'game_invite') {
      if (!game_data || !game_data.game_type || !GAME_TYPES.includes(game_data.game_type)) {
        return fail('请选择游戏类型');
      }
      final_game_data = {
        game_type: game_data.game_type,
        game_name: String(game_data.game_name || GAME_TYPE_LABELS[game_data.game_type] || game_data.game_type).slice(0, 40),
        message: String(game_data.message || '').slice(0, 200)
      };
      final_content = final_game_data.game_name;
    }

    const message_id = buildMessageId();
    const message = {
      message_id,
      match_id,
      from_user_id: user._id,
      to_user_id,
      content_type,
      content: final_content,
      game_data: final_game_data,
      is_read: false,
      created_at: db.serverDate()
    };

    await db.collection('friend_messages').add({ data: message });

    return success({
      message: {
        message_id,
        match_id,
        from_user_id: user._id,
        to_user_id,
        content_type,
        content: final_content,
        game_data: final_game_data,
        is_read: false
      }
    }, '发送成功');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('聊天功能暂不可用');
    return fail('发送失败: ' + error.message);
  }
}

// 获取聊天记录
async function dating_getMessages(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const match_id = event.match_id;
    if (!match_id) return fail('缺少匹配编号');

    // 验证匹配归属
    const match_res = await db.collection('dating_matches')
      .where({ match_id, is_active: true })
      .limit(1)
      .get();
    const match = match_res.data[0];
    if (!match) return fail('匹配关系不存在或已解除');
    if (match.user_id_1 !== user._id && match.user_id_2 !== user._id) return fail('无权查看');

    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(100, Math.max(5, Number(event.page_size) || 30));

    // 按时间倒序查询
    const res = await db.collection('friend_messages')
      .where({ match_id })
      .orderBy('created_at', 'desc')
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();

    // 反转成正序
    const messages = (res.data || []).reverse().map(item => ({
      message_id: item.message_id,
      match_id: item.match_id,
      from_user_id: item.from_user_id,
      to_user_id: item.to_user_id,
      content_type: item.content_type,
      content: item.content,
      game_data: item.game_data || null,
      is_read: !!item.is_read,
      created_at: item.created_at
    }));

    // 标记未读消息为已读（发给当前用户且未读的）
    const unread_ids = (res.data || [])
      .filter(item => item.to_user_id === user._id && !item.is_read)
      .map(item => item._id);

    if (unread_ids.length > 0) {
      try {
        await Promise.all(unread_ids.map(id =>
          db.collection('friend_messages').doc(id).update({ data: { is_read: true } })
        ));
      } catch (_) { /* 非关键，忽略 */ }
    }

    // 获取总数
    let total = messages.length;
    try {
      const count_res = await db.collection('friend_messages')
        .where({ match_id })
        .count();
      total = count_res.total || 0;
    } catch (_) { /* ignore */ }

    return success({
      messages,
      total,
      page,
      page_size,
      has_more: page * page_size < total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return success({ messages: [], total: 0, has_more: false });
    return fail('获取消息失败: ' + error.message);
  }
}

// 获取会话列表（带最后消息和未读数）
async function dating_getConversations() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    await repairAcceptedFriendRequestsForUser(user._id);

    // 获取所有活跃匹配
    let matches_data = [];
    try {
      const [as_user_1, as_user_2] = await Promise.all([
        db.collection('dating_matches')
          .where({ user_id_1: user._id, is_active: true })
          .limit(50)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          }),
        db.collection('dating_matches')
          .where({ user_id_2: user._id, is_active: true })
          .limit(50)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          })
      ]);

      const match_map = {};
      [...(as_user_1.data || []), ...(as_user_2.data || [])].forEach(match => {
        const key = match._id || match.match_id || buildMatchId(match.user_id_1, match.user_id_2);
        if (key) match_map[key] = match;
      });

      matches_data = await Promise.all(Object.values(match_map).map(normalizeMatchRecord));
      matches_data.sort((a, b) => {
        const time_a = new Date(a.matched_at || a.created_at || 0).getTime();
        const time_b = new Date(b.matched_at || b.created_at || 0).getTime();
        return time_b - time_a;
      });
      matches_data = matches_data.slice(0, 50);
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
      // 集合不存在，返回空列表
    }

    // 收集所有对方用户 ID
    const other_ids = [...new Set(matches_data.map(m => m.user_id_1 === user._id ? m.user_id_2 : m.user_id_1).filter(Boolean))];
    const match_ids = [...new Set(matches_data.map(m => m.match_id).filter(Boolean))];

    // 批量获取用户信息
    const users_map = {};
    try {
      if (other_ids.length > 0) {
        const users_res = await db.collection('users')
          .where({ _id: _.in(other_ids) })
          .field({ _id: true, nickname: true, avatar_url: true })
          .get();
        (users_res.data || []).forEach(u => { users_map[u._id] = u; });
      }
    } catch (_) { /* ignore */ }

    // 批量获取名片
    const cards_map = {};
    try {
      if (other_ids.length > 0) {
        const cards_res = await db.collection('profile_cards')
          .where({ user_id: _.in(other_ids) })
          .get();
        (cards_res.data || []).forEach(c => { cards_map[c.user_id] = c; });
      }
    } catch (_) { /* ignore */ }

    // 批量获取每个匹配的最后一条消息（聚合取巧：对每个 match_id 取最新一条）
    const last_msg_map = {};
    try {
      if (match_ids.length > 0) {
        // 微信云开发不支持聚合，改用逐个查询但用 in 缩小范围
        const all_msgs_res = await db.collection('friend_messages')
          .where({ match_id: _.in(match_ids) })
          .orderBy('created_at', 'desc')
          .limit(200)
          .get();
        // 对每个 match_id 取第一条（最新的）
        (all_msgs_res.data || []).forEach(msg => {
          if (!last_msg_map[msg.match_id]) {
            last_msg_map[msg.match_id] = {
              message_id: msg.message_id,
              from_user_id: msg.from_user_id,
              content_type: msg.content_type,
              content: msg.content,
              game_data: msg.game_data || null,
              created_at: msg.created_at
            };
          }
        });
      }
    } catch (_) { /* ignore */ }

    // 批量获取未读计数 — 逐个 count 不可避免，但总量可控
    const unread_map = {};
    try {
      if (match_ids.length > 0) {
        const unread_results = await Promise.all(
          match_ids.map(mid =>
            db.collection('friend_messages')
              .where({ match_id: mid, to_user_id: user._id, is_read: false })
              .count()
              .then(res => ({ mid, count: res.total || 0 }))
              .catch(() => ({ mid, count: 0 }))
          )
        );
        unread_results.forEach(r => { unread_map[r.mid] = r.count; });
      }
    } catch (_) { /* ignore */ }

    const conversations = [];
    for (const match of matches_data) {
      const other_id = match.user_id_1 === user._id ? match.user_id_2 : match.user_id_1;

      const usr = users_map[other_id] || {};
      const card = cards_map[other_id] || {};

      let display_name = usr.nickname || card.display_name || '神秘侦探';
      let avatar_url = usr.avatar_url || card.avatar_url || '';

      const other_user = { user_id: other_id, display_name, avatar_url };

      conversations.push({
        match_id: match.match_id,
        other_user: other_user,
        last_message: last_msg_map[match.match_id] || null,
        unread_count: unread_map[match.match_id] || 0,
        matched_at: match.matched_at
      });
    }

    // 按最后消息时间排序（有消息的在前）
    conversations.sort((a, b) => {
      const time_a = a.last_message ? new Date(a.last_message.created_at).getTime() : 0;
      const time_b = b.last_message ? new Date(b.last_message.created_at).getTime() : 0;
      return time_b - time_a;
    });

    return success({ conversations }, '获取成功');
  } catch (error) {
    return fail('获取会话列表失败: ' + error.message);
  }
}

// ========== 好友请求 ==========

function buildRequestId(from_user_id, to_user_id) {
  const ids = [safeIdPart(from_user_id), safeIdPart(to_user_id)].sort();
  return `fr_${ids[0]}_${ids[1]}`.slice(0, 64);
}

async function normalizeMatchRecord(match = {}) {
  const user_id_1 = match.user_id_1 || '';
  const user_id_2 = match.user_id_2 || '';
  const match_id = match.match_id || (user_id_1 && user_id_2 ? buildMatchId(user_id_1, user_id_2) : '');
  const patch = {};

  if (!match.match_id && match_id) patch.match_id = match_id;
  if (!match.updated_at) patch.updated_at = db.serverDate();

  if (Object.keys(patch).length > 0 && match._id) {
    try {
      await db.collection('dating_matches').doc(match._id).update({ data: patch });
    } catch (_) { /* 历史数据修补失败不影响展示 */ }
  }

  return {
    ...match,
    match_id,
    matched_at: match.matched_at || match.created_at || null
  };
}

async function ensureActiveMatchBetweenUsers(user_id_a, user_id_b) {
  if (!user_id_a || !user_id_b || user_id_a === user_id_b) return null;

  const [forward, reverse] = await Promise.all([
    db.collection('dating_matches')
      .where({ user_id_1: user_id_a, user_id_2: user_id_b })
      .limit(1)
      .get()
      .catch(error => {
        if (isCollectionMissing(error)) return { data: [] };
        throw error;
      }),
    db.collection('dating_matches')
      .where({ user_id_1: user_id_b, user_id_2: user_id_a })
      .limit(1)
      .get()
      .catch(error => {
        if (isCollectionMissing(error)) return { data: [] };
        throw error;
      })
  ]);

  const existing = [...(forward.data || []), ...(reverse.data || [])][0];
  if (existing) {
    const normalized = await normalizeMatchRecord(existing);
    await db.collection('dating_matches').doc(existing._id).update({
      data: {
        match_id: normalized.match_id,
        is_active: true,
        matched_at: normalized.matched_at || db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    return normalized.match_id;
  }

  const ids = [user_id_a, user_id_b].sort();
  const match_id = buildMatchId(ids[0], ids[1]);
  try {
    await db.collection('dating_matches').add({
      data: {
        _id: match_id,
        match_id,
        user_id_1: ids[0],
        user_id_2: ids[1],
        matched_at: db.serverDate(),
        is_active: true,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
  } catch (error) {
    if (isCollectionMissing(error)) throw error;
    await db.collection('dating_matches').doc(match_id).update({
      data: {
        match_id,
        user_id_1: ids[0],
        user_id_2: ids[1],
        matched_at: db.serverDate(),
        is_active: true,
        updated_at: db.serverDate()
      }
    });
  }
  return match_id;
}

async function repairAcceptedFriendRequestsForUser(user_id) {
  if (!user_id) return { repaired: 0, failed: 0 };

  let repaired = 0;
  let failed = 0;

  try {
    const [sent_accepted, received_accepted] = await Promise.all([
      db.collection('friend_requests')
        .where({ from_user_id: user_id, status: 'accepted' })
        .limit(100)
        .get()
        .catch(error => {
          if (isCollectionMissing(error)) return { data: [] };
          throw error;
        }),
      db.collection('friend_requests')
        .where({ to_user_id: user_id, status: 'accepted' })
        .limit(100)
        .get()
        .catch(error => {
          if (isCollectionMissing(error)) return { data: [] };
          throw error;
        })
    ]);

    const request_map = {};
    [...(sent_accepted.data || []), ...(received_accepted.data || [])].forEach(req => {
      const key = req.request_id || `${req.from_user_id}_${req.to_user_id}`;
      if (key) request_map[key] = req;
    });

    for (const req of Object.values(request_map)) {
      try {
        const match_id = await ensureActiveMatchBetweenUsers(req.from_user_id, req.to_user_id);
        if (match_id) repaired += 1;
      } catch (_) {
        failed += 1;
      }
    }
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }

  return { repaired, failed };
}

// 发送好友请求
async function dating_sendFriendRequest(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const raw_to_user_id = String(event.to_user_id || event.user_id || '').trim();
    if (!raw_to_user_id) return fail('请选择要添加的用户');

    const target_user = await resolveUserByIdentifier(raw_to_user_id);
    if (!target_user || !target_user._id) return fail('目标用户不存在');

    const to_user_id = target_user._id;
    if (to_user_id === user._id || target_user.openid === wx_context.OPENID) return fail('不能添加自己为好友');

    // 检查是否已经是好友
    let already_friend = false;
    try {
      const [forward, reverse] = await Promise.all([
        db.collection('dating_matches')
          .where({ user_id_1: user._id, user_id_2: to_user_id, is_active: true })
          .limit(1)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          }),
        db.collection('dating_matches')
          .where({ user_id_1: to_user_id, user_id_2: user._id, is_active: true })
          .limit(1)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          })
      ]);
      already_friend = (forward.data || []).length > 0 || (reverse.data || []).length > 0;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }
    if (already_friend) {
      const match_id = await ensureActiveMatchBetweenUsers(user._id, to_user_id);
      return success({ request_id: null, to_user_id, status: 'friend', is_friend: true, match_id }, '你们已经是好友了');
    }

    const request_id = buildRequestId(user._id, to_user_id);
    const message = String(event.message || '').trim().slice(0, 100);
    const pair_key = request_id.replace(/^fr_/, '');

    // 一对用户只保留一条请求记录：pending 防重复，declined 后允许重新发起。
    let existing_request = null;
    try {
      const existing_res = await db.collection('friend_requests')
        .where({ request_id })
        .limit(1)
        .get();
      existing_request = existing_res.data[0] || null;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 兼容旧数据：如果历史请求使用过非稳定 request_id，也不能再生成一条新的 pending。
    let legacy_pending_request = null;
    try {
      const [sent_pending, received_pending] = await Promise.all([
        db.collection('friend_requests')
          .where({ from_user_id: user._id, to_user_id, status: 'pending' })
          .limit(1)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          }),
        db.collection('friend_requests')
          .where({ from_user_id: to_user_id, to_user_id: user._id, status: 'pending' })
          .limit(1)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          })
      ]);
      legacy_pending_request = (sent_pending.data || [])[0] || (received_pending.data || [])[0] || null;
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }
    if (legacy_pending_request && legacy_pending_request.request_id !== request_id) {
      return fail('已有一条待处理的好友请求');
    }

    if (existing_request) {
      if (existing_request.status === 'pending') return fail('已有一条待处理的好友请求');
      if (existing_request.status === 'accepted') {
        let match_id = null;
        try {
          match_id = await ensureActiveMatchBetweenUsers(user._id, to_user_id);
        } catch (error) {
          if (isCollectionMissing(error)) return fail('好友功能暂不可用');
          throw error;
        }
        return success({ request_id, to_user_id, status: 'friend', is_friend: true, match_id }, '你们已经是好友了');
      }

      await db.collection('friend_requests').doc(existing_request._id).update({
        data: {
          from_user_id: user._id,
          to_user_id,
          status: 'pending',
          message,
          pair_key,
          created_at: db.serverDate(),
          updated_at: db.serverDate(),
          responded_at: _.remove()
        }
      });

      return success({ request_id, to_user_id, status: 'pending' }, '好友请求已重新发送');
    }

    await db.collection('friend_requests').add({
      data: {
        _id: request_id,
        request_id,
        pair_key,
        from_user_id: user._id,
        to_user_id,
        status: 'pending',
        message,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });

    return success({ request_id, to_user_id, status: 'pending' }, '好友请求已发送');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('好友功能暂不可用');
    return fail('发送好友请求失败: ' + error.message);
  }
}

// 获取好友请求列表
async function dating_getFriendRequests() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    await repairAcceptedFriendRequestsForUser(user._id);

    // 先查询收到的请求和发出的请求
    let recv_res = { data: [] };
    try {
      recv_res = await db.collection('friend_requests')
        .where({ to_user_id: user._id, status: 'pending' })
        .orderBy('created_at', 'desc')
        .limit(50)
        .get();
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    let sent_res = { data: [] };
    try {
      sent_res = await db.collection('friend_requests')
        .where({ from_user_id: user._id, status: 'pending' })
        .orderBy('created_at', 'desc')
        .limit(20)
        .get();
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 收集所有需要查询的用户 ID
    const recv_user_ids = (recv_res.data || []).map(r => r.from_user_id);
    const sent_user_ids = (sent_res.data || []).map(r => r.to_user_id);
    const all_user_ids = [...new Set([...recv_user_ids, ...sent_user_ids])];

    // 批量获取用户信息
    const user_map = {};
    try {
      if (all_user_ids.length > 0) {
        const users_res = await db.collection('users')
          .where({ _id: _.in(all_user_ids) })
          .field({ _id: true, nickname: true, avatar_url: true })
          .get();
        (users_res.data || []).forEach(u => { user_map[u._id] = u; });
      }
    } catch (_) { /* ignore */ }

    // 批量获取名片
    const card_map = {};
    try {
      if (all_user_ids.length > 0) {
        const cards_res = await db.collection('profile_cards')
          .where({ user_id: _.in(all_user_ids) })
          .get();
        (cards_res.data || []).forEach(c => { card_map[c.user_id] = c; });
      }
    } catch (_) { /* ignore */ }

    // 收到的请求
    let received = [];
    try {
      for (const req of (recv_res.data || [])) {
        const u = user_map[req.from_user_id] || {};
        const card = card_map[req.from_user_id] || {};
        const display_name = u.nickname || card.display_name || '神秘侦探';
        const avatar_url = u.avatar_url || card.avatar_url || '';

        received.push({
          request_id: req.request_id,
          from_user: { user_id: req.from_user_id, display_name, avatar_url },
          message: req.message,
          is_sent: false,
          created_at: req.created_at
        });
      }
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 发出的请求
    let sent = [];
    try {
      for (const req of (sent_res.data || [])) {
        const u = user_map[req.to_user_id] || {};
        const card = card_map[req.to_user_id] || {};
        const display_name = u.nickname || card.display_name || '神秘侦探';
        const avatar_url = u.avatar_url || card.avatar_url || '';

        sent.push({
          request_id: req.request_id,
          to_user: { user_id: req.to_user_id, display_name, avatar_url },
          message: req.message,
          is_sent: true,
          created_at: req.created_at
        });
      }
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }

    // 构建 ID 列表方便前端判断
    const friend_ids = [];
    try {
      const [as_user_1, as_user_2] = await Promise.all([
        db.collection('dating_matches')
          .where({ user_id_1: user._id, is_active: true })
          .limit(100)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          }),
        db.collection('dating_matches')
          .where({ user_id_2: user._id, is_active: true })
          .limit(100)
          .get()
          .catch(error => {
            if (isCollectionMissing(error)) return { data: [] };
            throw error;
          })
      ]);

      [...(as_user_1.data || []), ...(as_user_2.data || [])].forEach(m => {
        const friend_id = m.user_id_1 === user._id ? m.user_id_2 : m.user_id_1;
        if (friend_id && !friend_ids.includes(friend_id)) friend_ids.push(friend_id);
      });
    } catch (error) {
      if (!isCollectionMissing(error)) console.warn('load friend_ids failed:', error.message);
    }

    const pending_sent_ids = sent.map(r => r.to_user.user_id);

    return success({ received, sent, friend_ids, pending_sent_ids }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return success({ received: [], sent: [], friend_ids: [], pending_sent_ids: [] });
    return fail('获取好友请求失败: ' + error.message);
  }
}

// 响应好友请求
async function dating_respondFriendRequest(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const request_id = event.request_id;
    const action = event.friend_action || event.business_action || event.action;
    if (!request_id) return fail('缺少请求编号');
    if (!action || !['accept', 'decline'].includes(action)) return fail('操作类型错误');

    const req_res = await db.collection('friend_requests')
      .where({ request_id })
      .limit(1)
      .get();
    const req = req_res.data[0];
    if (!req) return fail('请求不存在');
    if (req.to_user_id !== user._id) return fail('无权操作此请求');
    if (req.status !== 'pending') return fail('该请求已处理');

    const new_status = action === 'accept' ? 'accepted' : 'declined';

    const update_res = await db.collection('friend_requests')
      .where({ _id: req._id, status: 'pending' })
      .update({
        data: {
          status: new_status,
          responded_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
    if (!update_res.stats || update_res.stats.updated === 0) return fail('该请求已处理');

    // 接受：创建好友关系
    let match_id = null;
    if (action === 'accept') {
      try {
        const [forward, reverse] = await Promise.all([
          db.collection('dating_matches')
            .where({ user_id_1: req.from_user_id, user_id_2: req.to_user_id })
            .limit(1)
            .get()
            .catch(error => {
              if (isCollectionMissing(error)) return { data: [] };
              throw error;
            }),
          db.collection('dating_matches')
            .where({ user_id_1: req.to_user_id, user_id_2: req.from_user_id })
            .limit(1)
            .get()
            .catch(error => {
              if (isCollectionMissing(error)) return { data: [] };
              throw error;
            })
        ]);
        const existing = { data: [...(forward.data || []), ...(reverse.data || [])] };

        if (existing.data.length > 0) {
          // 如果已有记录（可能被软删除），重新激活
          const existing_match = await normalizeMatchRecord(existing.data[0]);
          match_id = existing_match.match_id;
          await db.collection('dating_matches').doc(existing.data[0]._id).update({
            data: { match_id, is_active: true, matched_at: db.serverDate(), updated_at: db.serverDate() }
          });
        } else {
          const ids = [req.from_user_id, req.to_user_id].sort();
          match_id = buildMatchId(ids[0], ids[1]);
          try {
            await db.collection('dating_matches').add({
              data: {
                _id: match_id,
                match_id,
                user_id_1: ids[0],
                user_id_2: ids[1],
                matched_at: db.serverDate(),
                is_active: true,
                created_at: db.serverDate(),
                updated_at: db.serverDate()
              }
            });
          } catch (error) {
            if (isCollectionMissing(error)) return fail('好友功能暂不可用');
            await db.collection('dating_matches').doc(match_id).update({
              data: { is_active: true, matched_at: db.serverDate(), updated_at: db.serverDate() }
            });
          }
        }
      } catch (error) {
        if (isCollectionMissing(error)) return fail('好友功能暂不可用');
        throw error;
      }
    }

    return success({
      request_id,
      status: new_status,
      match_id
    }, action === 'accept' ? '已接受好友请求' : '已拒绝好友请求');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('好友功能暂不可用');
    return fail('操作失败: ' + error.message);
  }
}

async function dating_repairFriendRelations() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const result = await repairAcceptedFriendRequestsForUser(user._id);
    return success(result, '好友关系修复完成');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('好友功能暂不可用');
    return fail('好友关系修复失败: ' + error.message);
  }
}

// ========== 导出 ==========

exports.main = async (event, context) => {
  const { action = 'getDailyStatus', ...data } = event || {};
  const actions = {
    getDailyStatus: dating_getDailyStatus,
    getProfiles: dating_getProfiles,
    swipe: dating_swipe,
    getMatches: dating_getMatches,
    getMatchDetail: dating_getMatchDetail,
    updatePreferences: dating_updatePreferences,
    joinPool: dating_joinPool,
    leavePool: dating_leavePool,
    unmatch: dating_unmatch,
    sendInvitation: dating_sendInvitation,
    getInvitations: dating_getInvitations,
    respondInvitation: dating_respondInvitation,
    sendMessage: dating_sendMessage,
    getMessages: dating_getMessages,
    getConversations: dating_getConversations,
    sendFriendRequest: dating_sendFriendRequest,
    getFriendRequests: dating_getFriendRequests,
    respondFriendRequest: dating_respondFriendRequest,
    repairFriendRelations: dating_repairFriendRelations
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);

  return handler(data, context);
};
