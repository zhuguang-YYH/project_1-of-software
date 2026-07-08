const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const DEFAULT_REPLY = '我还没有找到对应线索。可以试试“积分”“排行”“帮助”等关键词。';
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW = 30 * 1000;

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

function cleanMessage(message) {
  return String(message || '').trim().slice(0, 200);
}

function normalizeRule(item = {}) {
  const keywords = Array.isArray(item.keywords)
    ? item.keywords.map(keyword => String(keyword || '').trim()).filter(Boolean)
    : String(item.keyword || '').split(/[,，\n]/).map(keyword => keyword.trim()).filter(Boolean);

  return {
    rule_id: item.rule_id || item._id || '',
    rule_name: item.rule_name || keywords[0] || 'Dud 回复规则',
    keyword: item.keyword || keywords[0] || '',
    keywords,
    category: item.category || 'general',
    match_type: item.match_type || 'exact',
    reply_content: item.reply_content || '',
    priority: Number(item.priority || 0),
    is_enabled: item.is_enabled !== false,
    match_count: Number(item.match_count || 0),
    created_by: item.created_by || '',
    created_at: item.created_at || '',
    updated_at: item.updated_at || ''
  };
}

function normalizeChatLog(item = {}) {
  const input_content = item.input_content || '';
  const reply_content = item.reply_content || '';
  const is_user_message = Boolean(input_content);

  return {
    message_id: item.message_id || item._id || '',
    user_id: item.user_id || '',
    message: is_user_message ? input_content : reply_content,
    content: is_user_message ? input_content : reply_content,
    type: is_user_message ? 'user' : 'dud',
    input_content,
    reply_content,
    matched_rule_id: item.matched_rule_id || '',
    created_at: item.created_at || ''
  };
}

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function checkRateLimit(user) {
  try {
    if (!user || !user._id) return true;
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW);
    const res = await db.collection('dud_messages')
      .where({ user_id: user._id, input_content: _.neq(''), created_at: _.gt(since) })
      .count();
    return res.total < RATE_LIMIT_COUNT;
  } catch (error) {
    if (isCollectionMissing(error)) return true;
    throw error;
  }
}

async function saveMessage(user, message, type, extra = {}) {
  const is_user_message = type === 'user';
  const res = await db.collection('dud_messages').add({
    data: {
      user_id: user && user._id ? user._id : '',
      input_content: is_user_message ? message : '',
      reply_content: is_user_message ? '' : message,
      matched_rule_id: extra.matched_rule_id || '',
      created_at: db.serverDate()
    }
  });
  await db.collection('dud_messages').doc(res._id).update({ data: { message_id: res._id } });
  return res._id;
}

function isMatched(rule, message) {
  const lower_message = message.toLowerCase();
  const keywords = rule.keywords || [];

  if (rule.match_type === 'multi_all') {
    return keywords.length > 0 && keywords.every(keyword => lower_message.includes(keyword.toLowerCase()));
  }

  if (rule.match_type === 'fuzzy') {
    return keywords.some(keyword => {
      const normalized = keyword.toLowerCase();
      return normalized && (lower_message.includes(normalized) || normalized.includes(lower_message));
    });
  }

  return keywords.some(keyword => keyword.toLowerCase() === lower_message);
}

async function findReply(message) {
  try {
    const res = await db.collection('dud_keywords')
      .where({ is_enabled: _.neq(false) })
      .limit(100)
      .get();
    const matched = (res.data || [])
      .map(normalizeRule)
      .filter(rule => rule.is_enabled !== false && rule.reply_content)
      .filter(rule => isMatched(rule, message))
      .sort((a, b) => b.priority - a.priority)[0];

    if (matched) {
      // Increment match_count
      try {
        await db.collection('dud_keywords').doc(matched.rule_id).update({
          data: {
            match_count: _.inc(1),
            last_matched_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
      } catch (_) { /* best-effort */ }

      return {
        reply_content: matched.reply_content,
        matched_keyword: matched.keywords.join(' / '),
        match_type: matched.match_type,
        rule_id: matched.rule_id,
        rule_name: matched.rule_name
      };
    }
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }

  return {
    reply_content: DEFAULT_REPLY,
    matched_keyword: '',
    match_type: 'fallback',
    rule_id: '',
    rule_name: ''
  };
}

async function dud_chat(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const message = cleanMessage(event.message);

    if (!message) return fail('请输入要发送的内容');
    if (!(await checkRateLimit(user))) {
      return fail('Dud 正在整理线索，请稍等一会儿再问。', 'RATE_LIMITED');
    }

    await saveMessage(user, message, 'user');
    const reply = await findReply(message);
    await saveMessage(user, reply.reply_content, 'dud', { matched_rule_id: reply.rule_id });

    return ok({
      user_message: {
        message,
        type: 'user',
        created_at: new Date()
      },
      dud_message: {
        message: reply.reply_content,
        type: 'dud',
        created_at: new Date(),
        matched_keyword: reply.matched_keyword,
        match_type: reply.match_type,
        rule_id: reply.rule_id,
        rule_name: reply.rule_name
      },
      reply_content: reply.reply_content,
      matched_keyword: reply.matched_keyword,
      match_type: reply.match_type,
      rule_id: reply.rule_id,
      rule_name: reply.rule_name
    }, '回复成功');
  } catch (error) {
    return fail('聊天失败: ' + error.message);
  }
}

async function dud_getChatHistory(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const page = Math.max(Number(event.page) || 1, 1);
    const page_size = Math.min(Math.max(Number(event.page_size) || 30, 1), 100);
    const where = user && user._id ? { user_id: user._id } : { user_id: '' };
    const res = await db.collection('dud_messages')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();
    const count_res = await db.collection('dud_messages').where(where).count();

    return ok({
      list: (res.data || []).reverse().map(normalizeChatLog),
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) {
      return ok({ list: [], total: 0, page: event.page || 1, page_size: event.page_size || 30, has_more: false }, '获取成功');
    }
    return fail('获取历史失败: ' + error.message);
  }
}

async function dud_getStats() {
  try {
    // Overall stats
    let total_keywords = 0;
    let total_messages = 0;
    let total_matches = 0;
    try {
      total_keywords = (await db.collection('dud_keywords').count()).total;
    } catch (_) { /* ignore */ }
    try {
      total_messages = (await db.collection('dud_messages').count()).total;
    } catch (_) { /* ignore */ }
    try {
      total_matches = (await db.collection('dud_messages').where({ matched_rule_id: _.neq('') }).count()).total;
    } catch (_) { /* ignore */ }

    // Top matched keywords
    let top_keywords = [];
    try {
      const top_res = await db.collection('dud_keywords')
        .where({ match_count: _.gt(0) })
        .orderBy('match_count', 'desc')
        .limit(10)
        .get();
      top_keywords = (top_res.data || []).map(item => ({
        rule_id: item.rule_id || item._id || '',
        keyword: item.keyword || '',
        category: item.category || 'general',
        match_count: Number(item.match_count || 0),
        is_enabled: item.is_enabled !== false
      }));
    } catch (_) { /* ignore */ }

    // Category breakdown
    let categories = [];
    try {
      const all_keywords = await db.collection('dud_keywords').limit(200).get();
      const cat_map = {};
      (all_keywords.data || []).forEach(item => {
        const cat = item.category || 'general';
        cat_map[cat] = (cat_map[cat] || 0) + 1;
      });
      categories = Object.entries(cat_map).map(([name, count]) => ({ name, count }));
    } catch (_) { /* ignore */ }

    return ok({
      total_keywords,
      total_messages,
      total_matches,
      top_keywords,
      categories
    });
  } catch (error) {
    return fail('获取统计失败: ' + error.message);
  }
}

async function dud_getKeywords(event) {
  try {
    const page = Math.max(Number(event.page) || 1, 1);
    const page_size = Math.min(Math.max(Number(event.page_size) || 30, 1), 100);
    const category = String(event.category || '').trim();

    const where = {};
    if (category && category !== 'all') where.category = category;

    const res = await db.collection('dud_keywords')
      .where(where)
      .orderBy('priority', 'desc')
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();
    const count_res = await db.collection('dud_keywords').where(where).count();

    return ok({
      list: (res.data || []).map(normalizeRule),
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    });
  } catch (error) {
    if (isCollectionMissing(error)) {
      return ok({ list: [], total: 0, page: 1, page_size: 30, has_more: false });
    }
    return fail('获取关键词失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'chat', ...data } = event || {};
  const actions = {
    chat: dud_chat,
    getChatHistory: dud_getChatHistory,
    getStats: dud_getStats,
    getKeywords: dud_getKeywords
  };
  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
