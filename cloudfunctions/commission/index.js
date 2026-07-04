const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// Configure these with the template IDs created in the WeChat public platform.
const COMMISSION_ACCEPTED_TMPL = process.env.COMMISSION_ACCEPTED_TMPL || 'W3lL_tFjTwrKtRwjX3cTVHo4SGh-JDNE1JwjDm4G50E';
const COMMISSION_REWARD_TMPL = process.env.COMMISSION_REWARD_TMPL || '5tWnGXcV42BnT2YI2FZ7OOBoZV28EeU-nBgTIH6IBZY';

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

function buildPublishRequestId(user_id, client_request_id) {
  const raw = String(client_request_id || '').trim();
  if (!raw) return '';
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `commission_${user_id}_${safe}`;
}

function getCommissionId(event = {}) {
  return event.commission_id || '';
}

function getAcceptanceId(event = {}) {
  return event.acceptance_id || '';
}

function isExpired(deadline) {
  if (!deadline) return false;
  const time = new Date(deadline).getTime();
  return !Number.isNaN(time) && Date.now() > time;
}

function isAdminUser(user = {}) {
  return String(user.role || '').toLowerCase() === 'admin';
}

function asThing(value, max = 20) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : '—';
}

function nowCstText() {
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${cst.getUTCFullYear()}-${p(cst.getUTCMonth() + 1)}-${p(cst.getUTCDate())} ${p(cst.getUTCHours())}:${p(cst.getUTCMinutes())}:${p(cst.getUTCSeconds())}`;
}

async function sendSubscribeMessage(touser, templateId, data, page) {
  if (!touser || !templateId) return false;
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

async function getCurrentUser() {
  const wxContext = cloud.getWXContext();
  const res = await db.collection('users').where({ openid: wxContext.OPENID }).limit(1).get();
  return res.data[0] || null;
}

async function getUserById(userId) {
  if (!userId) return null;
  try {
    const res = await db.collection('users').doc(userId).get();
    return res.data || null;
  } catch (error) {
    return null;
  }
}

function readPoints(user = {}, account = {}) {
  return {
    total_points: toNumber(account.total_points !== undefined ? account.total_points : user.total_points),
    available_points: toNumber(account.available_points !== undefined ? account.available_points : user.available_points),
    frozen_points: toNumber(account.frozen_points !== undefined ? account.frozen_points : user.frozen_points),
    used_points: toNumber(account.used_points !== undefined ? account.used_points : user.used_points)
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
  // 使用 user_id 派生稳定 _id，防止并发重复创建
  const stableId = `pa_${user._id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
  const data = {
    _id: stableId,
    user_id: user._id,
    total_points: points.total_points,
    available_points: points.available_points,
    frozen_points: points.frozen_points,
    used_points: points.used_points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  try {
    const addRes = await db.collection('point_accounts').add({ data });
    return { _id: addRes._id, ...data };
  } catch (error) {
    // _id 冲突 → 并发创建，读取已存在的记录
    if (!isCollectionMissing(error)) {
      const existed = await db.collection('point_accounts').doc(stableId).get();
      if (existed.data) return existed.data;
    }
    throw error;
  }
}

async function syncPoints(user, nextPoints) {
  const account = await ensurePointAccount(user);
  const data = {
    total_points: Math.max(0, toNumber(nextPoints.total_points)),
    available_points: Math.max(0, toNumber(nextPoints.available_points)),
    frozen_points: Math.max(0, toNumber(nextPoints.frozen_points)),
    used_points: Math.max(0, toNumber(nextPoints.used_points)),
    updated_at: db.serverDate()
  };
  await db.collection('users').doc(user._id).update({ data });
  await db.collection('point_accounts').doc(account._id).update({ data });
}

async function addPointLog(userId, data) {
  try {
    await db.collection('points_log').add({
      data: {
        user_id: userId,
        amount: data.amount,
        change_amount: data.amount,
        type: data.type,
        point_type: data.point_type,
        business_type: data.business_type,
        related_id: data.related_id,
        reason: data.reason,
        description: data.reason,
        created_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
}

function publicCommission(item = {}, currentUserId = '') {
  const id = item.commission_id || item._id || '';
  const reward = toNumber(item.reward_points);
  const remaining = item.remaining_reward !== undefined ? toNumber(item.remaining_reward) : reward;

  return {
    id,
    commission_id: id,
    publisher_id: item.publisher_id || '',
    publisher_name: item.publisher_name || '匿名侦探',
    title: item.title || '',
    content: item.content || '',
    description: item.content || '',
    reward_points: reward,
    remaining_reward: remaining,
    frozen_reward: toNumber(item.frozen_reward),
    reward_source: item.reward_source || 'publisher',
    deadline: item.deadline || '',
    status: item.status || 'recruiting',
    is_pinned: item.is_pinned === true,
    accepted_count: toNumber(item.accepted_count),
    completed_count: toNumber(item.completed_count),
    resolved_at: item.resolved_at || '',
    created_at: item.created_at || '',
    updated_at: item.updated_at || '',
    is_mine: item.publisher_id === currentUserId
  };
}

function publicAcceptance(item = {}) {
  const id = item.acceptance_id || item._id || '';
  return {
    id,
    acceptance_id: id,
    commission_id: item.commission_id || '',
    receiver_id: item.receiver_id || '',
    receiver_name: item.receiver_name || '匿名侦探',
    title: item.title || '',
    publisher_id: item.publisher_id || '',
    status: item.status || 'accepted',
    reward_points: toNumber(item.reward_points),
    accepted_at: item.accepted_at || '',
    completed_at: item.completed_at || '',
    rewarded_at: item.rewarded_at || '',
    created_at: item.created_at || '',
    updated_at: item.updated_at || ''
  };
}

async function getCommissionWithMeta(commission, currentUser) {
  const item = publicCommission(commission, currentUser && currentUser._id);
  let my_acceptance = null;

  if (currentUser && currentUser._id) {
    try {
      const res = await db.collection('commission_acceptances')
        .where({
          commission_id: item.commission_id,
          receiver_id: currentUser._id,
          status: _.neq('withdrawn')
        })
        .limit(1)
        .get();
      if (res.data.length > 0) my_acceptance = publicAcceptance(res.data[0]);
    } catch (error) {
      if (!isCollectionMissing(error)) throw error;
    }
  }

  return { ...item, my_acceptance };
}

async function commission_getCommissions(event) {
  try {
    const currentUser = await getCurrentUser();
    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(50, Math.max(1, Number(event.page_size) || 10));
    const skip = (page - 1) * page_size;
    const where = { status: _.in(['recruiting', 'in_progress']) };

    const res = await db.collection('commissions')
      .where(where)
      .orderBy('is_pinned', 'desc')
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();
    const countRes = await db.collection('commissions').where(where).count();
    const list = await Promise.all((res.data || []).map(item => getCommissionWithMeta(item, currentUser)));

    return ok({ list, total: countRes.total, page, page_size }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ list: [], total: 0, page: 1, page_size: 10 }, '获取成功');
    return fail('获取委托失败: ' + error.message);
  }
}

async function commission_getCommissionDetail(event) {
  try {
    const currentUser = await getCurrentUser();
    const commissionId = getCommissionId(event);
    if (!commissionId) return fail('委托编号不能为空');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const acceptanceRes = await db.collection('commission_acceptances')
      .where({ commission_id: commissionId })
      .orderBy('created_at', 'desc')
      .get();

    return ok({
      commission: await getCommissionWithMeta(commRes.data || {}, currentUser),
      acceptances: (acceptanceRes.data || []).map(publicAcceptance)
    }, '获取成功');
  } catch (error) {
    return fail('获取委托详情失败: ' + error.message);
  }
}

async function commission_publishCommission(event) {
  let lock_created = false;
  let points_frozen = false;
  let commission_doc_id = '';
  let user_id = '';
  let reward = 0;
  let officialReward = false;
  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');
    user_id = user._id;

    const title = String(event.title || '').trim();
    const content = String(event.content || event.description || '').trim();
    reward = Number(event.reward_points || event.reward || 0);
    const isPinned = event.is_pinned === true || event.isPinned === true;
    officialReward = isPinned && isAdminUser(user);
    const client_request_id = String(event.client_request_id || '').trim();

    if (!title) return fail('委托标题不能为空');
    if (!content) return fail('委托内容不能为空');
    if (!Number.isInteger(reward) || reward <= 0) return fail('奖励积分必须为正整数');

    const pointAccount = await ensurePointAccount(user);

    // 幂等锁：用 client_request_id 生成稳定 _id，先创建 processing 占位委托。
    // 防止前端重复提交导致重复发布和重复冻结积分。
    if (client_request_id) {
      commission_doc_id = buildPublishRequestId(user_id, client_request_id);
      try {
        await db.collection('commissions').add({
          data: {
            _id: commission_doc_id,
            commission_id: commission_doc_id,
            publisher_id: user_id,
            publisher_name: user.nickname || '匿名侦探',
            title,
            content,
            reward_points: reward,
            status: 'processing',
            client_request_id,
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
        lock_created = true;
      } catch (e) {
        if (isCollectionMissing(e)) throw e;
        // _id 冲突：已有同一请求记录，按状态幂等返回。
        const existed = await db.collection('commissions').doc(commission_doc_id).get();
        const old = existed.data || {};
        if (['recruiting', 'in_progress', 'resolved'].includes(old.status)) {
          return ok({ commission_id: old.commission_id || old._id, idempotent: true }, '发布成功');
        }
        if (old.status === 'processing') {
          return fail('发布请求正在处理中，请稍后刷新', 'REQUEST_PROCESSING');
        }
        // status === 'failed'：允许复用同一 _id 重试，继续往下冻结并回填。
        lock_created = true;
      }
    }

    // Freeze publisher points only when both users and point_accounts have enough available points.
    if (!officialReward) {
      const userAvailable = toNumber(user.available_points);
      const accountAvailable = toNumber(pointAccount.available_points);
      const effectiveAvailable = Math.min(userAvailable, accountAvailable);

      if (effectiveAvailable < reward) {
        if (lock_created && commission_doc_id) {
          try {
            await db.collection('commissions').doc(commission_doc_id).update({
              data: { status: 'failed', error_message: '可兑换积分不足', updated_at: db.serverDate() }
            });
          } catch (e) { console.error('标记发布失败失败:', e); }
        }
        return fail('可兑换积分不足，无法发布委托');
      }

      const accountFreezeRes = await db.collection('point_accounts').where({
        _id: pointAccount._id,
        available_points: _.gte(reward)
      }).update({
        data: {
          available_points: _.inc(-reward),
          frozen_points: _.inc(reward),
          updated_at: db.serverDate()
        }
      });
      if (!accountFreezeRes.stats || accountFreezeRes.stats.updated === 0) {
        if (lock_created && commission_doc_id) {
          try {
            await db.collection('commissions').doc(commission_doc_id).update({
              data: { status: 'failed', error_message: '可兑换积分不足', updated_at: db.serverDate() }
            });
          } catch (e) { console.error('标记发布失败失败:', e); }
        }
        return fail('可兑换积分不足，无法发布委托');
      }

      const userFreezeRes = await db.collection('users').where({
        _id: user_id,
        available_points: _.gte(reward)
      }).update({
        data: {
          available_points: _.inc(-reward),
          frozen_points: _.inc(reward),
          updated_at: db.serverDate()
        }
      });
      if (!userFreezeRes.stats || userFreezeRes.stats.updated === 0) {
        try {
          await db.collection('point_accounts').doc(pointAccount._id).update({
            data: {
              available_points: _.inc(reward),
              frozen_points: _.inc(-reward),
              updated_at: db.serverDate()
            }
          });
        } catch (e) { console.error('回滚积分账户冻结失败:', e); }
        if (lock_created && commission_doc_id) {
          try {
            await db.collection('commissions').doc(commission_doc_id).update({
              data: { status: 'failed', error_message: '可兑换积分不足', updated_at: db.serverDate() }
            });
          } catch (e) { console.error('标记发布失败失败:', e); }
        }
        return fail('可兑换积分不足，无法发布委托');
      }

      points_frozen = true;
    }

    const data = {
      publisher_id: user_id,
      publisher_name: user.nickname || '匿名侦探',
      title,
      content,
      reward_points: reward,
      remaining_reward: reward,
      frozen_reward: officialReward ? 0 : reward,
      reward_source: officialReward ? 'official' : 'publisher',
      deadline: event.deadline || '',
      status: 'recruiting',
      is_pinned: officialReward,
      accepted_count: 0,
      completed_count: 0,
      resolved_at: '',
      client_request_id,
      updated_at: db.serverDate()
    };

    if (commission_doc_id) {
      // 幂等锁路径：把占位记录补全为正式 recruiting 委托，保留原 created_at。
      await db.collection('commissions').doc(commission_doc_id).update({
        data: { ...data, commission_id: commission_doc_id }
      });
    } else {
      const res = await db.collection('commissions').add({
        data: { ...data, created_at: db.serverDate() }
      });
      commission_doc_id = res._id;
      await db.collection('commissions').doc(res._id).update({ data: { commission_id: res._id } });
    }

    if (!officialReward) {
      await addPointLog(user_id, {
        amount: reward,
        type: 'freeze',
        point_type: 'frozen',
        business_type: 'commission_freeze',
        related_id: commission_doc_id,
        reason: `发布委托冻结积分 - ${title}`
      });
    }

    return ok({ commission_id: commission_doc_id }, '发布成功');
  } catch (error) {
    // 回滚冻结：仅非官方委托且确认已冻结时执行。
    if (points_frozen && !officialReward && user_id && reward > 0) {
      try {
        await db.collection('users').doc(user_id).update({
          data: {
            available_points: _.inc(reward),
            frozen_points: _.inc(-reward),
            updated_at: db.serverDate()
          }
        });
        await db.collection('point_accounts').where({ user_id }).update({
          data: {
            available_points: _.inc(reward),
            frozen_points: _.inc(-reward),
            updated_at: db.serverDate()
          }
        });
      } catch (e) { console.error('回滚发布积分失败:', e); }
    }
    if (lock_created && commission_doc_id) {
      try {
        await db.collection('commissions').doc(commission_doc_id).update({
          data: { status: 'failed', error_message: error.message || '发布失败', updated_at: db.serverDate() }
        });
      } catch (e) { console.error('标记发布失败失败:', e); }
    }
    return fail('发布失败: ' + error.message);
  }
}

async function commission_acceptCommission(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');

    const commissionId = getCommissionId(event);
    if (!commissionId) return fail('委托编号不能为空');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const commission = commRes.data || {};
    if (!commission._id && !commission.commission_id) return fail('委托不存在');
    if (commission.publisher_id === user._id) return fail('不能领取自己发布的委托');
    if (!['recruiting', 'in_progress'].includes(commission.status)) return fail('该委托当前不可领取');
    if (isExpired(commission.deadline)) return fail('该委托已超过截止时间');

    // 使用稳定 _id 防重复领取：同一 commission + 同一 receiver 第二次 add 必然失败。
    const stable_id = `ca_${commissionId}_${user._id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);

    const data = {
      _id: stable_id,
      acceptance_id: stable_id,
      commission_id: commission.commission_id || commissionId,
      receiver_id: user._id,
      receiver_name: user.nickname || '匿名侦探',
      title: commission.title || '',
      publisher_id: commission.publisher_id || '',
      status: 'accepted',
      reward_points: 0,
      accepted_at: db.serverDate(),
      completed_at: '',
      rewarded_at: '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };

    try {
      await db.collection('commission_acceptances').add({ data });
    } catch (error) {
      // _id 冲突：检查是否已经领取，决定幂等返回或抛出真实错误。
      const dup = await db.collection('commission_acceptances')
        .where({ _id: stable_id })
        .limit(1).get();
      if (dup.data.length > 0) {
        const old = dup.data[0];
        if (old.status === 'withdrawn') return fail('你已退回该委托，请联系发布者重新发起');
        return ok({ acceptance_id: old._id, idempotent: true }, '已领取过该委托');
      }
      throw error;
    }

    await db.collection('commissions').doc(commission.commission_id || commissionId).update({
      data: {
        status: 'in_progress',
        accepted_count: _.inc(1),
        updated_at: db.serverDate()
      }
    });

    const publisher = await getUserById(commission.publisher_id);
    if (publisher && publisher.openid) {
      await sendSubscribeMessage(publisher.openid, COMMISSION_ACCEPTED_TMPL, {
        thing1: { value: asThing(commission.title || '委托', 20) },
        thing3: { value: asThing(user.nickname || '匿名侦探', 20) },
        time4: { value: nowCstText() },
        thing5: { value: asThing('你的委托已被领取', 20) }
      }, 'pages/commission/index');
    }

    return ok({ acceptance_id: stable_id }, '领取成功');
  } catch (error) {
    return fail('领取失败: ' + error.message);
  }
}

async function commission_completeCommission(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('请先登录', 'USER_NOT_FOUND');

    const acceptanceId = getAcceptanceId(event);
    if (!acceptanceId) return fail('领取记录编号不能为空');

    const accRes = await db.collection('commission_acceptances').doc(acceptanceId).get();
    const acceptance = accRes.data || {};
    if (!acceptance._id && !acceptance.acceptance_id) return fail('领取记录不存在');
    if (acceptance.receiver_id !== user._id) return fail('只能完成自己领取的委托');

    // 条件原子更新：必须当前 status='accepted' 才能流转为 'completed'。
    const updateRes = await db.collection('commission_acceptances').where({
      _id: acceptanceId,
      status: 'accepted'
    }).update({
      data: {
        status: 'completed',
        completed_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    if (!updateRes.stats || updateRes.stats.updated === 0) {
      return fail('该委托状态不可标记完成，可能已被处理');
    }
    await db.collection('commissions').doc(acceptance.commission_id).update({
      data: {
        completed_count: _.inc(1),
        updated_at: db.serverDate()
      }
    });

    return ok(null, '已提交完成，等待发布者确认');
  } catch (error) {
    return fail('完成失败: ' + error.message);
  }
}

async function commission_allocateRewards(event) {
  try {
    const publisher = await getCurrentUser();
    if (!publisher) return fail('请先登录', 'USER_NOT_FOUND');

    const commissionId = getCommissionId(event);
    const acceptanceId = getAcceptanceId(event);
    const points = Number(event.allocated_points || event.points || 0);

    if (!commissionId || !acceptanceId) return fail('委托和领取记录不能为空');
    if (!Number.isInteger(points) || points <= 0) return fail('分配积分必须为正整数');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const commission = commRes.data || {};
    if (!commission._id && !commission.commission_id) return fail('委托不存在');
    if (commission.publisher_id !== publisher._id) return fail('只有发布者可以分配奖励');

    const remainingReward = toNumber(commission.remaining_reward);
    if (points > remainingReward) return fail('分配积分不能超过剩余奖励');

    const accRes = await db.collection('commission_acceptances').doc(acceptanceId).get();
    const acceptance = accRes.data || {};
    if ((!acceptance._id && !acceptance.acceptance_id) || acceptance.commission_id !== (commission.commission_id || commissionId)) {
      return fail('领取记录不存在');
    }

    const receiver = await getUserById(acceptance.receiver_id);
    if (!receiver) return fail('领取者信息不存在');

    const officialReward = commission.reward_source === 'official';
    const realCommissionId = commission.commission_id || commissionId;

    // ===== 关键原子操作：状态流转 =====
    // 1) acceptance：必须当前 status='completed' 才能转为 'rewarded'，防止双重发放。
    const accUpdate = await db.collection('commission_acceptances').where({
      _id: acceptanceId,
      status: 'completed'
    }).update({
      data: {
        status: 'rewarded',
        reward_points: points,
        rewarded_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    if (!accUpdate.stats || accUpdate.stats.updated === 0) {
      return fail('该领取记录当前状态不可分配奖励，可能已被发放');
    }

    // 2) commission：必须 remaining_reward >= points 才能扣减。
    const commUpdate = await db.collection('commissions').where({
      _id: realCommissionId,
      remaining_reward: _.gte(points)
    }).update({
      data: {
        remaining_reward: _.inc(-points),
        frozen_reward: officialReward ? 0 : _.inc(-points),
        updated_at: db.serverDate()
      }
    });
    if (!commUpdate.stats || commUpdate.stats.updated === 0) {
      // 极端竞态：回滚 acceptance 状态。
      await db.collection('commission_acceptances').doc(acceptanceId).update({
        data: { status: 'completed', reward_points: 0, rewarded_at: '', updated_at: db.serverDate() }
      });
      return fail('委托剩余奖励不足，分配失败');
    }

    // 3) 领取者加分（原子 inc）。
    await ensurePointAccount(receiver);
    await db.collection('users').doc(receiver._id).update({
      data: {
        total_points: _.inc(points),
        available_points: _.inc(points),
        updated_at: db.serverDate()
      }
    });
    try {
      await db.collection('point_accounts').where({ user_id: receiver._id }).update({
        data: {
          total_points: _.inc(points),
          available_points: _.inc(points),
          updated_at: db.serverDate()
        }
      });
    } catch (e) { if (!isCollectionMissing(e)) throw e; }

    // 4) 发布者：非官方委托才解冻并计入已用。
    if (!officialReward) {
      await ensurePointAccount(publisher);
      await db.collection('users').doc(publisher._id).update({
        data: {
          frozen_points: _.inc(-points),
          used_points: _.inc(points),
          updated_at: db.serverDate()
        }
      });
      try {
        await db.collection('point_accounts').where({ user_id: publisher._id }).update({
          data: {
            frozen_points: _.inc(-points),
            used_points: _.inc(points),
            updated_at: db.serverDate()
          }
        });
      } catch (e) { if (!isCollectionMissing(e)) throw e; }
    }

    // 5) 委托整体已分配完成，标记为 resolved。
    const nextRemainingReward = remainingReward - points;
    if (nextRemainingReward <= 0) {
      await db.collection('commissions').doc(realCommissionId).update({
        data: { status: 'resolved', resolved_at: db.serverDate(), updated_at: db.serverDate() }
      });
    }

    // 6) 写分配记录和积分流水。
    const allocationRes = await db.collection('commission_allocations').add({
      data: {
        commission_id: realCommissionId,
        acceptance_id: acceptanceId,
        receiver_id: acceptance.receiver_id,
        allocated_points: points,
        created_at: db.serverDate()
      }
    });
    await db.collection('commission_allocations').doc(allocationRes._id).update({
      data: { allocation_id: allocationRes._id }
    });

    await addPointLog(receiver._id, {
      amount: points,
      type: 'income',
      point_type: 'available',
      business_type: officialReward ? 'official_commission_reward' : 'commission_reward',
      related_id: realCommissionId,
      reason: `委托奖励 - ${commission.title || ''}`
    });

    if (receiver.openid) {
      await sendSubscribeMessage(receiver.openid, COMMISSION_REWARD_TMPL, {
        thing2: { value: asThing(commission.title || '委托奖励', 20) },
        time3: { value: nowCstText() },
        amount4: { value: `${points}积分` },
        thing6: { value: asThing('奖励积分已发放', 20) }
      }, 'pages/commission/index');
    }

    return ok({ remaining_reward: nextRemainingReward }, '奖励分配成功');
  } catch (error) {
    return fail('分配失败: ' + error.message);
  }
}

async function commission_getMyCommissions(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return ok({ published: [], accepted: [], page: 1, page_size: 20 }, '获取成功');

    const page = Math.max(1, Number(event.page) || 1);
    const page_size = Math.min(50, Math.max(1, Number(event.page_size) || 20));
    const skip = (page - 1) * page_size;

    const publishedRes = await db.collection('commissions')
      .where({ publisher_id: user._id, status: _.nin(['processing', 'failed']) })
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();

    const acceptedRes = await db.collection('commission_acceptances')
      .where({ receiver_id: user._id })
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(page_size)
      .get();

    const published = await Promise.all((publishedRes.data || []).map(async item => {
      const commission = publicCommission(item, user._id);
      const accRes = await db.collection('commission_acceptances')
        .where({ commission_id: commission.commission_id })
        .orderBy('created_at', 'desc')
        .get();
      return {
        ...commission,
        acceptances: (accRes.data || []).map(publicAcceptance)
      };
    }));

    const accepted = await Promise.all((acceptedRes.data || []).map(async item => {
      const acceptance = publicAcceptance(item);
      let commission = null;
      try {
        const commRes = await db.collection('commissions').doc(acceptance.commission_id).get();
        commission = publicCommission(commRes.data || {}, user._id);
      } catch (error) {
        commission = null;
      }
      return { ...acceptance, commission };
    }));

    return ok({ published, accepted, page, page_size }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ published: [], accepted: [], page: 1, page_size: 20 }, '获取成功');
    return fail('获取我的委托失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getCommissions', ...data } = event || {};
  const actions = {
    getCommissions: commission_getCommissions,
    getCommissionDetail: commission_getCommissionDetail,
    publish: commission_publishCommission,
    publishCommission: commission_publishCommission,
    accept: commission_acceptCommission,
    acceptCommission: commission_acceptCommission,
    complete: commission_completeCommission,
    completeCommission: commission_completeCommission,
    allocateRewards: commission_allocateRewards,
    getMyCommissions: commission_getMyCommissions
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作: ${action}`);
  return handler({ ...data }, context);
};
