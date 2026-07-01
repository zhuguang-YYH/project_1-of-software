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

function isCollectionMissing(error) {
  return error && (
    error.errCode === -502005 ||
    String(error.message || '').includes('not exist') ||
    String(error.message || '').includes('collection not exists')
  );
}

async function notification_getList(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user_res = await db.collection('users')
      .where({ openid: wx_context.OPENID })
      .limit(1)
      .get();
    const user = user_res.data[0] || null;
    const user_id = user ? user._id : '';

    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(100, Math.max(1, Number(event.page_size) || 30));
    const where = user_id ? { user_id } : { user_id: '' };

    const [list_res, count_res, unread_res] = await Promise.all([
      db.collection('notifications')
        .where(where)
        .orderBy('created_at', 'desc')
        .skip((page - 1) * page_size)
        .limit(page_size)
        .get(),
      db.collection('notifications').where(where).count(),
      db.collection('notifications').where({ ...where, is_read: false }).count()
    ]);

    return ok({
      list: list_res.data || [],
      total: count_res.total,
      unread_count: unread_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    });
  } catch (error) {
    if (isCollectionMissing(error)) {
      return ok({ list: [], total: 0, unread_count: 0, page: 1, page_size: 30, has_more: false });
    }
    return fail('获取通知失败: ' + error.message);
  }
}

async function notification_markRead(event) {
  try {
    const notification_id = String(event.notification_id || '').trim();
    if (!notification_id) return fail('缺少通知编号');

    const wx_context = cloud.getWXContext();
    const user_res = await db.collection('users')
      .where({ openid: wx_context.OPENID })
      .limit(1)
      .get();
    const user_id = (user_res.data[0] || {})._id || '';

    const res = await db.collection('notifications')
      .where({ notification_id, user_id })
      .limit(1)
      .get();

    if (res.data.length === 0) return fail('通知不存在');

    await db.collection('notifications').doc(res.data[0]._id).update({
      data: { is_read: true, read_at: db.serverDate() }
    });
    return ok(null, '已标为已读');
  } catch (error) {
    return fail('操作失败: ' + error.message);
  }
}

async function notification_markAllRead(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user_res = await db.collection('users')
      .where({ openid: wx_context.OPENID })
      .limit(1)
      .get();
    const user_id = (user_res.data[0] || {})._id || '';
    if (!user_id) return fail('用户不存在');

    await db.collection('notifications')
      .where({ user_id, is_read: false })
      .update({
        data: { is_read: true, read_at: db.serverDate() }
      });

    return ok(null, '已全部标为已读');
  } catch (error) {
    if (isCollectionMissing(error)) return ok(null, '操作成功');
    return fail('操作失败: ' + error.message);
  }
}

// 工具函数：创建通知（供其他云函数调用，通过 HTTP 或内部调用）
async function notification_create(event) {
  try {
    const user_id = String(event.user_id || '').trim();
    const type = String(event.type || 'system').trim();
    const title = String(event.title || '').trim();
    const content = String(event.content || '').trim();
    const link_url = String(event.link_url || '').trim();

    if (!user_id || !title) return fail('缺少必要参数');

    const data = {
      user_id,
      type,
      title,
      content,
      link_url,
      is_read: false,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };

    const res = await db.collection('notifications').add({ data });
    const notification_id = res._id;
    await db.collection('notifications').doc(notification_id).update({
      data: { notification_id }
    });

    return ok({ notification_id }, '通知已创建');
  } catch (error) {
    return fail('创建通知失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getList', ...data } = event || {};
  const actions = {
    getList: notification_getList,
    markRead: notification_markRead,
    markAllRead: notification_markAllRead,
    create: notification_create
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
