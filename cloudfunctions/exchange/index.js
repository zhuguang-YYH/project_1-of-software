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

// 积分兑换通知订阅消息模板
const EXCHANGE_NOTIFY_TMPL = 'd1_r_egCRaHIEqMg3mj-Z32-jli_O11ZjLa-fwhos3c';

function asThing(value, max = 20) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : '—';
}

// 当前北京时间（云函数运行在 UTC，+8h 后取 UTC 各字段）："YYYY-MM-DD HH:mm:ss"
function nowCstText() {
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${cst.getUTCFullYear()}-${p(cst.getUTCMonth() + 1)}-${p(cst.getUTCDate())} ${p(cst.getUTCHours())}:${p(cst.getUTCMinutes())}:${p(cst.getUTCSeconds())}`;
}

// 下发订阅消息（best-effort：用户未授权/格式异常都不影响主流程）
async function sendSubscribeMessage(touser, templateId, data, page) {
  if (!touser) return false;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId,
      page: page || 'pages/index/index',
      miniprogramState: 'formal',
      lang: 'zh_CN',
      data
    });
    return true;
  } catch (error) {
    console.warn('[subscribe] send failed:', templateId, error && (error.errCode || error.errMsg || error.message));
    return false;
  }
}

function buildExchangeRequestId(user_id, client_request_id) {
  const raw = String(client_request_id || '').trim();
  if (!raw) return '';
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `exchange_${user_id}_${safe}`;
}

const GOOD_TAG_TEXT = {
  new: '新品',
  limited: '限量',
  limited_time: '限时'
};

function normalizeTagType(value) {
  const tag_type = String(value || '').trim();
  return GOOD_TAG_TEXT[tag_type] ? tag_type : '';
}

function readTagText(item = {}) {
  const tag_type = normalizeTagType(item.tag_type);
  return String(item.tag_text || GOOD_TAG_TEXT[tag_type] || '').trim();
}

function buildPickupCode(exchange_id) {
  const seed = String(exchange_id || Date.now()).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return seed.slice(-6).padStart(6, '0');
}

function buildPickupQrText(exchange_id, pickup_code) {
  return `EXCHANGE:${exchange_id}:${pickup_code}`;
}

function normalizeGood(item = {}) {
  const item_id = item.item_id || item._id || '';
  const exchange_points = toNumber(item.exchange_points);
  const available_quantity = toNumber(item.available_quantity);
  const tag_type = normalizeTagType(item.tag_type);
  const stock_warning_threshold = Math.max(0, toNumber(item.stock_warning_threshold === undefined ? 3 : item.stock_warning_threshold));

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
    tag_type,
    tag_text: readTagText(item),
    stock_warning_threshold,
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
    pickup_code: item.pickup_code || '',
    pickup_qr_text: item.pickup_qr_text || '',
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

// 原子扣减积分：仅当 available_points 足额时才扣减并冻结。
// 防止"先查后改"在并发场景下导致积分超扣。
async function atomicFreezePoints(user_id, total_cost) {
  const res = await db.collection('users').where({
    _id: user_id,
    available_points: _.gte(total_cost)
  }).update({
    data: {
      available_points: _.inc(-total_cost),
      frozen_points: _.inc(total_cost),
      updated_at: db.serverDate()
    }
  });
  if (!res.stats || res.stats.updated === 0) {
    throw new Error('可用积分不足或账户已变化');
  }
  // 同步 point_accounts（容错：缺失则忽略，下次 ensurePointAccount 时会重建）
  try {
    await db.collection('point_accounts').where({ user_id }).update({
      data: {
        available_points: _.inc(-total_cost),
        frozen_points: _.inc(total_cost),
        updated_at: db.serverDate()
      }
    });
  } catch (e) { if (!isCollectionMissing(e)) throw e; }
}

async function rollbackFreezePoints(user_id, total_cost) {
  try {
    await db.collection('users').doc(user_id).update({
      data: {
        available_points: _.inc(total_cost),
        frozen_points: _.inc(-total_cost),
        updated_at: db.serverDate()
      }
    });
    await db.collection('point_accounts').where({ user_id }).update({
      data: {
        available_points: _.inc(total_cost),
        frozen_points: _.inc(-total_cost),
        updated_at: db.serverDate()
      }
    });
  } catch (e) { if (!isCollectionMissing(e)) throw e; }
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
      .filter(item => item.status !== 'offline' && item.available_quantity > 0 && item.exchange_points > 0);

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
  let stock_decreased = false;
  let points_frozen = false;
  let lock_created = false;
  let exchange_doc_id = '';
  let item_id = '';
  let quantity = 1;
  let total_cost = 0;
  let user_id = '';
  let client_request_id = '';

  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');
    user_id = user._id;

    item_id = event.item_id || event.goods_id;
    quantity = Math.max(1, Number(event.quantity) || 1);
    client_request_id = String(event.client_request_id || '').trim();

    // 幂等锁：先用稳定 _id 创建占位记录，避免并发重复请求穿透到扣库存/扣积分。
    if (client_request_id) {
      exchange_doc_id = buildExchangeRequestId(user_id, client_request_id);
      try {
        await db.collection('exchange_records').add({
          data: {
            _id: exchange_doc_id,
            exchange_id: exchange_doc_id,
            user_id,
            item_id,
            quantity,
            status: 'processing',
            client_request_id,
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
        lock_created = true;
      } catch (e) {
        if (isCollectionMissing(e)) throw e;

        const existed = await db.collection('exchange_records').doc(exchange_doc_id).get();
        const old = existed.data || {};
        if (['pending', 'shipped', 'completed', 'received'].includes(old.status)) {
          return ok({
            exchange_id: old.exchange_id || old._id,
            points_cost: toNumber(old.points_cost || old.total_cost),
            pickup_code: old.pickup_code || '',
            pickup_qr_text: old.pickup_qr_text || '',
            idempotent: true
          }, '兑换成功');
        }
        if (old.status === 'processing') {
          return fail('兑换请求正在处理中，请稍后刷新', 'REQUEST_PROCESSING');
        }
        return fail(old.error_message || '该兑换请求已处理失败，请重新发起兑换', 'REQUEST_FAILED');
      }
    }

    const good = await getGoodById(item_id);
    if (!good) return fail('兑换商品不存在');
    if (good.status === 'offline' || good.status === 'discontinued') return fail('该商品已下架');
    if (good.available_quantity < quantity) return fail('库存不足');
    if (good.exchange_points <= 0) return fail('该商品暂不可兑换');

    total_cost = good.exchange_points * quantity;
    await ensurePointAccount(user);

    // 1) 原子扣库存
    await updateStock(item_id, -quantity);
    stock_decreased = true;

    // 2) 原子冻结积分
    await atomicFreezePoints(user_id, total_cost);
    points_frozen = true;

    // 3) 写兑换记录
    const pickup_code = exchange_doc_id ? buildPickupCode(exchange_doc_id) : '';
    const pickup_qr_text = pickup_code ? buildPickupQrText(exchange_doc_id, pickup_code) : '';
    const data = {
      user_id,
      item_id,
      item_source: 'inventory_items',
      goods_name: good.item_name,
      quantity,
      unit_cost: good.exchange_points,
      points_cost: total_cost,
      total_cost,
      status: 'pending',
      pickup_code,
      pickup_qr_text,
      client_request_id,
      exchange_time: db.serverDate(),
      created_at: db.serverDate(),
      handled_by: '',
      handled_at: '',
      updated_at: db.serverDate()
    };
    if (exchange_doc_id) {
      await db.collection('exchange_records').doc(exchange_doc_id).update({ data });
    } else {
      const res = await db.collection('exchange_records').add({ data });
      exchange_doc_id = res._id;
      const next_pickup_code = buildPickupCode(exchange_doc_id);
      await db.collection('exchange_records').doc(res._id).update({
        data: {
          exchange_id: res._id,
          pickup_code: next_pickup_code,
          pickup_qr_text: buildPickupQrText(exchange_doc_id, next_pickup_code)
        }
      });
    }

    // 兑换通知（best-effort）：仅当用户已填学号时下发
    const student_id = String((user && user.student_id) || '').trim();
    if (student_id) {
      await sendSubscribeMessage(cloud.getWXContext().OPENID, EXCHANGE_NOTIFY_TMPL, {
        thing2: { value: asThing(good.item_name || '兑换商品', 20) },
        number3: { value: quantity },
        thing6: { value: '兑换成功，到货后请留意领取通知' },
        character_string10: { value: student_id.slice(0, 32) },
        time7: { value: nowCstText() }
      }, 'pages/exchange/index');
    }

    const final_pickup_code = buildPickupCode(exchange_doc_id);
    return ok({
      exchange_id: exchange_doc_id,
      points_cost: total_cost,
      pickup_code: final_pickup_code,
      pickup_qr_text: buildPickupQrText(exchange_doc_id, final_pickup_code)
    }, '兑换成功');
  } catch (error) {
    // 回滚：按已完成的步骤逆序回退
    if (points_frozen && user_id && total_cost > 0) {
      try { await rollbackFreezePoints(user_id, total_cost); } catch (e) { console.error('回滚积分失败:', e); }
    }
    if (stock_decreased && item_id && quantity > 0) {
      try { await updateStock(item_id, quantity); } catch (e) { console.error('回滚库存失败:', e); }
    }
    if (lock_created && exchange_doc_id) {
      try {
        await db.collection('exchange_records').doc(exchange_doc_id).update({
          data: {
            status: 'failed',
            error_message: error.message || '兑换失败',
            updated_at: db.serverDate()
          }
        });
      } catch (e) { console.error('标记兑换失败失败:', e); }
    }
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
