const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function ok(data = null, message = '操作成功') {
  return { code: 0, data, message };
}

function fail(message) {
  return { code: -1, message };
}

function isCollectionMissing(error) {
  return error && (
    error.errCode === -502005 ||
    String(error.message || '').includes('not exist') ||
    String(error.message || '').includes('collection not exists')
  );
}

function cleanText(value, max_length) {
  return String(value || '').trim().slice(0, max_length);
}

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

function normalizeFeedback(item = {}) {
  const feedback_id = item.feedback_id || item._id || '';
  const feedback_type = item.feedback_type || 'general';
  const admin_remark = item.admin_remark || '';
  const created_at = item.created_at || '';

  return {
    feedback_id,
    user_id: item.user_id || '',
    content: item.content || '',
    feedback_type,
    is_anonymous: item.is_anonymous === true,
    status: item.status || 'pending',
    admin_remark,
    handled_by: item.handled_by || '',
    handled_at: item.handled_at || '',
    created_at,
    updated_at: item.updated_at || created_at
  };
}

async function feedback_submit(event) {
  try {
    const wx_context = cloud.getWXContext();
    const content = cleanText(event.content, 500);
    const feedback_type = cleanText(event.feedback_type || 'general', 30) || 'general';
    const is_anonymous = event.is_anonymous === true;

    if (!content) return fail('反馈内容不能为空');
    if (content.length < 5) return fail('反馈内容至少需要 5 个字');

    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const res = await db.collection('feedback').add({
      data: {
        user_id: user._id,
        content,
        feedback_type,
        is_anonymous,
        status: 'pending',
        admin_remark: '',
        handled_by: '',
        handled_at: '',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    await db.collection('feedback').doc(res._id).update({ data: { feedback_id: res._id } });

    return ok({ feedback_id: res._id }, '反馈成功');
  } catch (error) {
    return fail('提交反馈失败: ' + error.message);
  }
}

async function feedback_getMyFeedback(event) {
  try {
    const wx_context = cloud.getWXContext();
    const page = Math.max(Number(event.page) || 1, 1);
    const page_size = Math.min(Math.max(Number(event.page_size) || 20, 1), 50);
    const skip = (page - 1) * page_size;
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const where = { user_id: user._id };
    const res = await db.collection('feedback')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();
    const count_res = await db.collection('feedback').where(where).count();

    return ok({
      list: (res.data || []).map(normalizeFeedback),
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) {
      return ok({ list: [], total: 0, page: event.page || 1, page_size: event.page_size || 20, has_more: false }, '获取成功');
    }
    return fail('获取反馈失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'submit', ...data } = event || {};
  const actions = {
    submit: feedback_submit,
    getMyFeedback: feedback_getMyFeedback
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
