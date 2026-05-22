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

function numberValue(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isBorrowableInventoryItem(item) {
  const item_type = String(item.item_type || '').toLowerCase();
  return ['book', 'script', 'script_murder', 'supplies', 'material'].includes(item_type);
}

function isScriptItem(item) {
  const item_type = String(item.item_type || '').toLowerCase();
  const category = String(item.category || '').toLowerCase();
  return item_type === 'script' ||
    item_type === 'script_murder' ||
    category === 'script' ||
    category === '剧本杀' ||
    category.includes('剧本');
}

function normalizeInventoryItem(item = {}) {
  const item_id = item.item_id || item._id || '';
  const item_name = item.item_name || '';
  const total_quantity = numberValue(item.total_quantity, 1);
  const available_quantity = numberValue(item.available_quantity, 0);

  return {
    item_id,
    item_name,
    item_type: item.item_type || 'book',
    category: item.category || item.genre || '',
    description: item.description || '',
    total_quantity,
    available_quantity,
    status: item.status || 'available',
    cover_url: item.cover_url || '',
    borrow_count: numberValue(item.borrow_count, 0),
    genre: item.genre || '',
    min_players: numberValue(item.min_players, 0),
    max_players: numberValue(item.max_players, 0),
    player_range: item.player_range || '',
    duration_minutes: numberValue(item.duration_minutes, 0),
    difficulty: item.difficulty || '',
    created_at: item.created_at || '',
    updated_at: item.updated_at || ''
  };
}

function normalizeBorrowRecord(item = {}) {
  const application_id = item.application_id || item.borrow_id || item._id || '';
  const borrower_id = item.borrower_id || item.user_id || '';

  return {
    application_id,
    borrow_id: item.borrow_id || application_id,
    item_id: item.item_id || '',
    item_name: item.item_name || '',
    item_source: item.item_source || 'inventory_items',
    user_id: item.user_id || borrower_id,
    borrower_id,
    borrower_name: item.borrower_name || '',
    reason: item.reason || '',
    expected_return_date: item.expected_return_date || '',
    status: item.status || 'in_transit',
    requested_at: item.requested_at || item.created_at || '',
    lent_at: item.lent_at || '',
    returned_at: item.returned_at || '',
    cancelled_at: item.cancelled_at || '',
    handled_by: item.handled_by || '',
    created_at: item.created_at || item.requested_at || '',
    updated_at: item.updated_at || item.created_at || item.requested_at || ''
  };
}

async function getCurrentUser(openid) {
  try {
    const res = await db.collection('users').where({ openid }).limit(1).get();
    return res.data[0] || null;
  } catch (error) {
    if (isCollectionMissing(error)) return null;
    throw error;
  }
}

async function queryInventoryItems({ page, page_size, borrow_only = true }) {
  try {
    const res = await db.collection('inventory_items')
      .where({ status: _.neq('discontinued') })
      .orderBy('created_at', 'desc')
      .limit(200)
      .get();

    let list = (res.data || []).map(normalizeInventoryItem);
    if (borrow_only) list = list.filter(isBorrowableInventoryItem);

    const skip = (page - 1) * page_size;
    return {
      list: list.slice(skip, skip + page_size),
      total: list.length
    };
  } catch (error) {
    if (isCollectionMissing(error)) return { list: [], total: 0 };
    throw error;
  }
}

async function getBorrowItemById(item_id) {
  if (!item_id) return null;
  try {
    const res = await db.collection('inventory_items').doc(item_id).get();
    return res.data ? normalizeInventoryItem(res.data) : null;
  } catch (error) {
    if (isCollectionMissing(error)) return null;
    throw error;
  }
}

async function updateBorrowItemStatus(item, data) {
  if (!item) return;
  const where = data.status === 'in_transit'
    ? { _id: item.item_id, status: 'available' }
    : { _id: item.item_id };
  const res = await db.collection('inventory_items').where(where).update({
    data: {
      ...data,
      updated_at: db.serverDate()
    }
  });

  if (res.stats && res.stats.updated === 0) {
    throw new Error('物资状态已变化，请刷新后重试');
  }
}

async function upsertBorrowRecord(application_id, data) {
  try {
    const existed = await db.collection('borrow_records').where({ application_id }).limit(1).get();
    if (existed.data.length > 0) {
      await db.collection('borrow_records').doc(existed.data[0]._id).update({ data });
      return existed.data[0]._id;
    }

    const res = await db.collection('borrow_records').add({
      data: {
        ...data,
        borrow_id: application_id,
        application_id
      }
    });
    return res._id;
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
    return '';
  }
}

async function listBorrowHistory(user, page, page_size) {
  if (!user || !user._id) return { list: [], total: 0 };
  const where = { user_id: user._id };
  const res = await db.collection('borrow_applications')
    .where(where)
    .orderBy('created_at', 'desc')
    .skip((page - 1) * page_size)
    .limit(page_size)
    .get();
  const count_res = await db.collection('borrow_applications').where(where).count();
  return { list: res.data || [], total: count_res.total };
}

async function borrow_getItems(event) {
  const page = Math.max(numberValue(event.page, 1), 1);
  const page_size = Math.min(Math.max(numberValue(event.page_size, 10), 1), 50);
  try {
    const inventory = await queryInventoryItems({ page, page_size, borrow_only: true });
    return ok({
      list: inventory.list,
      total: inventory.total,
      page,
      page_size,
      has_more: page * page_size < inventory.total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ list: [], total: 0, page, page_size, has_more: false }, '获取成功');
    return fail('获取物资列表失败: ' + error.message);
  }
}

async function borrow_getItemDetail(event) {
  try {
    const item = await getBorrowItemById(event.item_id);
    if (!item) return fail('借阅物资不存在');
    return ok(item, '获取成功');
  } catch (error) {
    return fail('获取物资详情失败: ' + error.message);
  }
}

async function borrow_applyBorrow(event) {
  let pending_application_id = '';
  let target_item = null;
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const item_id = event.item_id;
    const reason = String(event.reason || '').trim();
    const expected_return_date = event.expected_return_date || '';
    target_item = await getBorrowItemById(item_id);

    if (!user) return fail('请先完成授权登录');
    if (!target_item) return fail('借阅物资不存在');
    if (target_item.status !== 'available') return fail('此物资暂不可借');

    const borrower_id = user._id;
    const borrower_name = user.nickname || '未知用户';
    const data = {
      user_id: borrower_id,
      borrower_id,
      borrower_name,
      item_id,
      item_name: target_item.item_name || '借阅物资',
      item_source: 'inventory_items',
      reason,
      expected_return_date,
      status: 'in_transit',
      requested_at: db.serverDate(),
      lent_at: '',
      returned_at: '',
      cancelled_at: '',
      handled_by: '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };

    const app_res = await db.collection('borrow_applications').add({ data });
    pending_application_id = app_res._id;
    const ids = { borrow_id: app_res._id, application_id: app_res._id };

    await db.collection('borrow_applications').doc(app_res._id).update({ data: ids });
    await upsertBorrowRecord(app_res._id, { ...data, ...ids });
    await updateBorrowItemStatus(target_item, {
      status: 'in_transit',
      current_borrower_id: borrower_id,
      current_application_id: app_res._id,
      borrow_count: _.inc(1)
    });

    return ok({ application_id: app_res._id, borrow_id: app_res._id }, '申请成功');
  } catch (error) {
    if (pending_application_id) {
      try {
        await db.collection('borrow_applications').doc(pending_application_id).update({
          data: {
            status: 'cancelled',
            cancelled_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
        await upsertBorrowRecord(pending_application_id, {
          status: 'cancelled',
          cancelled_at: db.serverDate(),
          updated_at: db.serverDate()
        });
        if (target_item) {
          await updateBorrowItemStatus(target_item, {
            status: 'available',
            current_borrower_id: '',
            current_application_id: ''
          });
        }
      } catch (rollback_error) {
        console.log('rollback borrow application failed:', rollback_error.message);
      }
    }
    return fail('申请失败: ' + error.message);
  }
}

async function borrow_getBorrowHistory(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const page = Math.max(numberValue(event.page, 1), 1);
    const page_size = Math.min(Math.max(numberValue(event.page_size, 10), 1), 50);
    const records = await listBorrowHistory(user, page, page_size);

    return ok({
      list: (records.list || []).map(normalizeBorrowRecord),
      total: records.total,
      page,
      page_size,
      has_more: page * page_size < records.total
    }, '获取成功');
  } catch (error) {
    return fail('获取借阅历史失败: ' + error.message);
  }
}

async function borrow_cancelBorrow(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const application_id = event.application_id || event.borrow_id;

    if (!user) return fail('请先完成授权登录');
    if (!application_id) return fail('缺少借阅申请编号');

    const app_res = await db.collection('borrow_applications').doc(application_id).get();
    const app = normalizeBorrowRecord(app_res.data || {});

    if (app.user_id !== user._id) return fail('只能取消自己的借阅申请');
    if (!['applying', 'in_transit'].includes(app.status)) return fail('此状态不可取消');

    const data = {
      status: 'cancelled',
      cancelled_at: db.serverDate(),
      updated_at: db.serverDate()
    };
    await db.collection('borrow_applications').doc(application_id).update({ data });
    await upsertBorrowRecord(application_id, data);

    if (app.item_id) {
      const item = await getBorrowItemById(app.item_id);
      await updateBorrowItemStatus(item, {
        status: 'available',
        current_borrower_id: '',
        current_application_id: ''
      });
    }

    return ok(null, '取消成功');
  } catch (error) {
    return fail('取消失败: ' + error.message);
  }
}

async function borrow_getScripts(event) {
  try {
    const page = Math.max(numberValue(event.page, 1), 1);
    const page_size = Math.min(Math.max(numberValue(event.page_size, 20), 1), 50);
    const genre = String(event.genre || '').trim();
    const difficulty = String(event.difficulty || '').trim();
    const status = String(event.status || '').trim();
    const inventory = await queryInventoryItems({ page: 1, page_size: 200, borrow_only: true });
    let list = inventory.list.filter(isScriptItem);

    if (genre) list = list.filter(item => String(item.genre || '').includes(genre));
    if (difficulty) list = list.filter(item => item.difficulty === difficulty);
    if (status) list = list.filter(item => item.status === status);

    const skip = (page - 1) * page_size;
    return ok({
      list: list.slice(skip, skip + page_size),
      total: list.length,
      page,
      page_size,
      has_more: page * page_size < list.length
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ list: [], total: 0, page: 1, page_size: 20, has_more: false }, '获取成功');
    return fail('获取剧本杀列表失败: ' + error.message);
  }
}

async function borrow_getStats() {
  try {
    const [record_count, current_count, book_count, script_count] = await Promise.all([
      db.collection('borrow_applications').count(),
      db.collection('borrow_applications').where({ status: 'in_transit' }).count(),
      db.collection('inventory_items').where({ item_type: 'book' }).count(),
      db.collection('inventory_items').where({ item_type: 'script' }).count()
    ]);
    const popular_res = await db.collection('inventory_items')
      .orderBy('borrow_count', 'desc')
      .limit(1)
      .get();

    return ok({
      total_borrowed: record_count.total,
      current_borrowing: current_count.total,
      total_books: book_count.total,
      total_scripts: script_count.total,
      most_popular_item: popular_res.data[0] ? normalizeInventoryItem(popular_res.data[0]) : null
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) {
      return ok({
        total_borrowed: 0,
        current_borrowing: 0,
        total_books: 0,
        total_scripts: 0,
        most_popular_item: null
      }, '获取成功');
    }
    return fail('获取借阅统计失败: ' + error.message);
  }
}

async function borrow_getInTransitInfo(event) {
  try {
    const item_id = event.item_id;
    if (!item_id) return fail('缺少物资编号');

    const res = await db.collection('borrow_applications')
      .where({ item_id, status: 'in_transit' })
      .orderBy('created_at', 'desc')
      .limit(1)
      .get();
    const record = normalizeBorrowRecord(res.data[0] || {});

    return ok({
      borrower_name: record.borrower_name || '',
      requested_at: record.requested_at || '',
      expected_return_date: record.expected_return_date || ''
    }, '获取成功');
  } catch (error) {
    return fail('获取传递中信息失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getItems', ...data } = event || {};
  const actions = {
    getItems: borrow_getItems,
    getItemDetail: borrow_getItemDetail,
    applyBorrow: borrow_applyBorrow,
    getBorrowHistory: borrow_getBorrowHistory,
    cancelBorrow: borrow_cancelBorrow,
    getScripts: borrow_getScripts,
    getStats: borrow_getStats,
    getInTransitInfo: borrow_getInTransitInfo
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
