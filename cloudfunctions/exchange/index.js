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

function normalizeGood(item = {}) {
  const item_id = item.item_id || item._id || '';
  const exchange_points = toNumber(item.exchange_points);
  const available_quantity = toNumber(item.available_quantity);

  return {
    item_id,
    item_name: item.item_name || '',
    item_type: item.item_type || 'exchange_good',
    category: item.category || '',
    description: item.description || '',
    cover_url: item.cover_url || '',
    exchange_points,
    original_cost: toNumber(item.original_cost || exchange_points),
    available_quantity,
    total_quantity: toNumber(item.total_quantity || available_quantity),
    status: item.status || 'available',
    exchanged_count: toNumber(item.exchanged_count),
    created_at: item.created_at || '',
    updated_at: item.updated_at || ''
  };
}

function normalizeRecord(item = {}) {
  const exchange_id = item.exchange_id || item._id || '';
  return {
    exchange_id,
    user_id: item.user_id || '',
    item_id: item.item_id || item.goods_id || '',
    goods_name: item.goods_name || item.item_name || '',
    quantity: toNumber(item.quantity || 1),
    unit_cost: toNumber(item.unit_cost),
    points_cost: toNumber(item.points_cost),
    total_cost: toNumber(item.total_cost || item.points_cost),
    status: item.status || 'pending',
    exchange_time: item.exchange_time || item.created_at || '',
    created_at: item.created_at || item.exchange_time || '',
    handled_by: item.handled_by || '',
    handled_at: item.handled_at || '',
    updated_at: item.updated_at || ''
  };
}

async function getCurrentUser() {
  const wx_context = cloud.getWXContext();
  const res = await db.collection('users').where({ openid: wx_context.OPENID }).limit(1).get();
  return res.data[0] || null;
}

async function ensurePointAccount(user) {
  try {
    const res = await db.collection('point_accounts').where({ user_id: user._id }).limit(1).get();
    if (res.data.length > 0) return res.data[0];
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }

  const data = {
    user_id: user._id,
    total_points: toNumber(user.total_points),
    available_points: toNumber(user.available_points),
    frozen_points: toNumber(user.frozen_points),
    used_points: toNumber(user.used_points),
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const res = await db.collection('point_accounts').add({ data });
  return { _id: res._id, ...data };
}

function readPoints(user = {}, account = {}) {
  return {
    total_points: toNumber(account.total_points !== undefined ? account.total_points : user.total_points),
    available_points: toNumber(account.available_points !== undefined ? account.available_points : user.available_points),
    frozen_points: toNumber(account.frozen_points !== undefined ? account.frozen_points : user.frozen_points),
    used_points: toNumber(account.used_points !== undefined ? account.used_points : user.used_points)
  };
}

async function syncPoints(user, points) {
  const account = await ensurePointAccount(user);
  const data = {
    total_points: Math.max(0, toNumber(points.total_points)),
    available_points: Math.max(0, toNumber(points.available_points)),
    frozen_points: Math.max(0, toNumber(points.frozen_points)),
    used_points: Math.max(0, toNumber(points.used_points)),
    updated_at: db.serverDate()
  };
  await db.collection('users').doc(user._id).update({ data });
  await db.collection('point_accounts').doc(account._id).update({ data });
}

async function getGoodById(item_id) {
  if (!item_id) return null;
  try {
    const res = await db.collection('inventory_items').doc(item_id).get();
    return res.data ? normalizeGood(res.data) : null;
  } catch (error) {
    if (isCollectionMissing(error)) return null;
    throw error;
  }
}

async function updateStock(item_id, quantity_delta) {
  const where = quantity_delta < 0
    ? { _id: item_id, available_quantity: _.gte(Math.abs(quantity_delta)) }
    : { _id: item_id };

  const res = await db.collection('inventory_items').where(where).update({
    data: {
      available_quantity: _.inc(quantity_delta),
      exchanged_count: _.inc(-quantity_delta),
      updated_at: db.serverDate()
    }
  });

  if (res.stats && res.stats.updated === 0) {
    throw new Error('库存不足或商品状态已变化');
  }
}

async function exchange_getGoods(event) {
  try {
    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(50, Math.max(1, Number(event.page_size) || 10));
    const skip = (page - 1) * page_size;

    const where = { item_type: 'exchange_good', status: _.neq('discontinued') };
    const res = await db.collection('inventory_items')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();
    const count_res = await db.collection('inventory_items').where(where).count();
    const list = (res.data || [])
      .map(normalizeGood)
      .filter(item => item.available_quantity > 0 && item.exchange_points > 0);

    return ok({
      list,
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ list: [], total: 0, page: 1, page_size: 10, has_more: false }, '获取成功');
    return fail('获取商品列表失败: ' + error.message);
  }
}

async function exchange_getProductDetail(event) {
  try {
    const goods = await getGoodById(event.item_id || event.goods_id);
    if (!goods) return fail('兑换商品不存在');
    return ok(goods, '获取成功');
  } catch (error) {
    return fail('获取商品详情失败: ' + error.message);
  }
}

async function exchange_exchange(event) {
  let good = null;
  let point_snapshot = null;

  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');

    const item_id = event.item_id || event.goods_id;
    const quantity = Math.max(1, Number(event.quantity) || 1);
    good = await getGoodById(item_id);

    if (!good) return fail('兑换商品不存在');
    if (good.available_quantity < quantity) return fail('库存不足');

    const points = readPoints(user, await ensurePointAccount(user));
    const total_cost = good.exchange_points * quantity;
    point_snapshot = points;

    if (points.available_points < total_cost) return fail('可用积分不足');

    const data = {
      user_id: user._id,
      item_id,
      item_source: 'inventory_items',
      goods_name: good.item_name,
      quantity,
      unit_cost: good.exchange_points,
      points_cost: total_cost,
      total_cost,
      status: 'pending',
      exchange_time: db.serverDate(),
      created_at: db.serverDate(),
      handled_by: '',
      handled_at: '',
      updated_at: db.serverDate()
    };

    await updateStock(item_id, -quantity);
    try {
      await syncPoints(user, {
        ...points,
        available_points: points.available_points - total_cost,
        frozen_points: points.frozen_points + total_cost
      });
    } catch (error) {
      await updateStock(item_id, quantity);
      throw error;
    }

    try {
      const res = await db.collection('exchange_records').add({ data });
      await db.collection('exchange_records').doc(res._id).update({ data: { exchange_id: res._id } });
      return ok({ exchange_id: res._id, points_cost: total_cost }, '兑换成功');
    } catch (error) {
      await updateStock(item_id, quantity);
      await syncPoints(user, point_snapshot);
      throw error;
    }
  } catch (error) {
    return fail('兑换失败: ' + error.message);
  }
}

async function exchange_getExchangeHistory(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return ok({ list: [], total: 0, page: 1, page_size: 10, has_more: false }, '获取成功');

    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(50, Math.max(1, Number(event.page_size) || 10));
    const skip = (page - 1) * page_size;
    const where = { user_id: user._id };

    const res = await db.collection('exchange_records')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();
    const count_res = await db.collection('exchange_records').where(where).count();

    return ok({
      list: (res.data || []).map(normalizeRecord),
      total: count_res.total,
      page,
      page_size,
      has_more: page * page_size < count_res.total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ list: [], total: 0, page: 1, page_size: 10, has_more: false }, '获取成功');
    return fail('获取兑换历史失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getGoods', ...data } = event || {};
  const actions = {
    getGoods: exchange_getGoods,
    getProducts: exchange_getGoods,
    getProductDetail: exchange_getProductDetail,
    doExchange: exchange_exchange,
    exchange: exchange_exchange,
    getExchangeHistory: exchange_getExchangeHistory,
    getMyExchanges: exchange_getExchangeHistory
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作: ${action}`);
  return handler(data, context);
};
