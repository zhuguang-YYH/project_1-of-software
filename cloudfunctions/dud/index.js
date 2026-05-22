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
    match_type: item.match_type || 'exact',
    reply_content: item.reply_content || '',
    priority: Number(item.priority || 0),
    is_enabled: item.is_enabled !== false,
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

exports.main = async (event, context) => {
  const { action = 'chat', ...data } = event || {};
  const actions = {
    chat: dud_chat,
    getChatHistory: dud_getChatHistory
  };
  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
