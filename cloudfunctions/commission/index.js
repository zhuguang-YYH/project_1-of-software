const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function ok(data = null, message = '鎿嶄綔鎴愬姛') {
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
  const data = {
    user_id: user._id,
    total_points: points.total_points,
    available_points: points.available_points,
    frozen_points: points.frozen_points,
    used_points: points.used_points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const addRes = await db.collection('point_accounts').add({ data });
  return { _id: addRes._id, ...data };
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
    publisher_name: item.publisher_name || '鍖垮悕渚︽帰',
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
    receiver_name: item.receiver_name || '鍖垮悕渚︽帰',
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

    return ok({ list, total: countRes.total, page, page_size }, '鑾峰彇鎴愬姛');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ list: [], total: 0, page: 1, page_size: 10 }, '鑾峰彇鎴愬姛');
    return fail('鑾峰彇濮旀墭澶辫触: ' + error.message);
  }
}

async function commission_getCommissionDetail(event) {
  try {
    const currentUser = await getCurrentUser();
    const commissionId = getCommissionId(event);
    if (!commissionId) return fail('濮旀墭缂栧彿涓嶈兘涓虹┖');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const acceptanceRes = await db.collection('commission_acceptances')
      .where({ commission_id: commissionId })
      .orderBy('created_at', 'desc')
      .get();

    return ok({
      commission: await getCommissionWithMeta(commRes.data || {}, currentUser),
      acceptances: (acceptanceRes.data || []).map(publicAcceptance)
    }, '鑾峰彇鎴愬姛');
  } catch (error) {
    return fail('鑾峰彇濮旀墭璇︽儏澶辫触: ' + error.message);
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
    if (!user) return fail('璇峰厛鐧诲綍', 'USER_NOT_FOUND');
    user_id = user._id;

    const title = String(event.title || '').trim();
    const content = String(event.content || event.description || '').trim();
    reward = Number(event.reward_points || event.reward || 0);
    const isPinned = event.is_pinned === true || event.isPinned === true;
    officialReward = isPinned && isAdminUser(user);
    const client_request_id = String(event.client_request_id || '').trim();

    if (!title) return fail('濮旀墭鏍囬涓嶈兘涓虹┖');
    if (!content) return fail('濮旀墭鍐呭涓嶈兘涓虹┖');
    if (!Number.isInteger(reward) || reward <= 0) return fail('濂栧姳绉垎蹇呴』涓烘鏁存暟');

    const pointAccount = await ensurePointAccount(user);

    // 骞傜瓑閿侊細鐢?client_request_id 鐢熸垚绋冲畾 _id 鍒涘缓 processing 鍗犱綅濮旀墭銆?
    // 闃叉璺ㄥ墠绔幓閲嶇獥鍙ｇ殑閲嶅鎻愪氦瀵艰嚧閲嶅鍙戝竷 + 閲嶅鍐荤粨绉垎锛堝嵄闄╂柟鍚戠殑閲嶅鎵ｅ噺锛夈€?
    if (client_request_id) {
      commission_doc_id = buildPublishRequestId(user_id, client_request_id);
      try {
        await db.collection('commissions').add({
          data: {
            _id: commission_doc_id,
            commission_id: commission_doc_id,
            publisher_id: user_id,
            publisher_name: user.nickname || '鍖垮悕渚︽帰',
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
        // _id 鍐茬獊 鈫?宸叉湁鍚屼竴璇锋眰璁板綍锛屾寜鍏剁姸鎬佸箓绛夎繑鍥?
        const existed = await db.collection('commissions').doc(commission_doc_id).get();
        const old = existed.data || {};
        if (['recruiting', 'in_progress', 'resolved'].includes(old.status)) {
          return ok({ commission_id: old.commission_id || old._id, idempotent: true }, '鍙戝竷鎴愬姛');
        }
        if (old.status === 'processing') {
          return fail('发布请求正在处理中，请稍后刷新', 'REQUEST_PROCESSING');
        }
        // status === 'failed'锛氬厑璁稿鐢ㄥ悓涓€ _id 閲嶈瘯锛堢户缁線涓嬪喕缁撳苟鍥炲～锛?
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
      publisher_name: user.nickname || '鍖垮悕渚︽帰',
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
      // 骞傜瓑閿佽矾寰勶細鎶婂崰浣嶈褰曡ˉ鍏ㄤ负姝ｅ紡 recruiting 濮旀墭锛堜繚鐣欏師 created_at锛?
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
        reason: `鍙戝竷濮旀墭鍐荤粨绉垎 - ${title}`
      });
    }

    return ok({ commission_id: commission_doc_id }, '鍙戝竷鎴愬姛');
  } catch (error) {
    // 鍥炴粴鍐荤粨锛堥潪瀹樻柟濮旀墭涓旂‘宸插喕缁擄級
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
      } catch (e) { console.error('鍥炴粴鍙戝竷绉垎澶辫触:', e); }
    }
    if (lock_created && commission_doc_id) {
      try {
        await db.collection('commissions').doc(commission_doc_id).update({
          data: { status: 'failed', error_message: error.message || '鍙戝竷澶辫触', updated_at: db.serverDate() }
        });
      } catch (e) { console.error('鏍囪鍙戝竷澶辫触澶辫触:', e); }
    }
    return fail('鍙戝竷澶辫触: ' + error.message);
  }
}

async function commission_acceptCommission(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('璇峰厛鐧诲綍', 'USER_NOT_FOUND');

    const commissionId = getCommissionId(event);
    if (!commissionId) return fail('濮旀墭缂栧彿涓嶈兘涓虹┖');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const commission = commRes.data || {};
    if (!commission._id && !commission.commission_id) return fail('委托不存在');
    if (commission.publisher_id === user._id) return fail('不能领取自己发布的委托');
    if (!['recruiting', 'in_progress'].includes(commission.status)) return fail('该委托当前不可领取');
    if (isExpired(commission.deadline)) return fail('璇ュ鎵樺凡瓒呰繃鎴鏃堕棿');

    // 鐢ㄧǔ瀹?_id 闃查噸澶嶉鍙栵細鍚屼竴 commission + 鍚屼竴 receiver 绗簩娆?add 蹇呭け璐?
    const stable_id = `ca_${commissionId}_${user._id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);

    const data = {
      _id: stable_id,
      acceptance_id: stable_id,
      commission_id: commission.commission_id || commissionId,
      receiver_id: user._id,
      receiver_name: user.nickname || '鍖垮悕渚︽帰',
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
      // _id 鍐茬獊 鈫?妫€鏌ユ槸鍚︽槸宸查鍙栵紝鍐冲畾骞傜瓑杩斿洖杩樻槸鐪熸鍑洪敊
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

    return ok({ acceptance_id: stable_id }, '棰嗗彇鎴愬姛');
  } catch (error) {
    return fail('棰嗗彇澶辫触: ' + error.message);
  }
}

async function commission_completeCommission(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('璇峰厛鐧诲綍', 'USER_NOT_FOUND');

    const acceptanceId = getAcceptanceId(event);
    if (!acceptanceId) return fail('棰嗗彇璁板綍缂栧彿涓嶈兘涓虹┖');

    const accRes = await db.collection('commission_acceptances').doc(acceptanceId).get();
    const acceptance = accRes.data || {};
    if (!acceptance._id && !acceptance.acceptance_id) return fail('领取记录不存在');
    if (acceptance.receiver_id !== user._id) return fail('只能完成自己领取的委托');

    // 鏉′欢鍘熷瓙鏇存柊锛氬繀椤诲綋鍓?status='accepted' 鎵嶈兘娴佽浆鍒?'completed'
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
    return fail('瀹屾垚澶辫触: ' + error.message);
  }
}

async function commission_allocateRewards(event) {
  try {
    const publisher = await getCurrentUser();
    if (!publisher) return fail('璇峰厛鐧诲綍', 'USER_NOT_FOUND');

    const commissionId = getCommissionId(event);
    const acceptanceId = getAcceptanceId(event);
    const points = Number(event.allocated_points || event.points || 0);

    if (!commissionId || !acceptanceId) return fail('委托和领取记录不能为空');
    if (!Number.isInteger(points) || points <= 0) return fail('鍒嗛厤绉垎蹇呴』涓烘鏁存暟');

    const commRes = await db.collection('commissions').doc(commissionId).get();
    const commission = commRes.data || {};
    if (!commission._id && !commission.commission_id) return fail('委托不存在');
    if (commission.publisher_id !== publisher._id) return fail('只有发布者可以分配奖励');

    const remainingReward = toNumber(commission.remaining_reward);
    if (points > remainingReward) return fail('鍒嗛厤绉垎涓嶈兘瓒呰繃鍓╀綑濂栧姳');

    const accRes = await db.collection('commission_acceptances').doc(acceptanceId).get();
    const acceptance = accRes.data || {};
    if ((!acceptance._id && !acceptance.acceptance_id) || acceptance.commission_id !== (commission.commission_id || commissionId)) {
      return fail('领取记录不存在');
    }

    const receiver = await getUserById(acceptance.receiver_id);
    if (!receiver) return fail('棰嗗彇鑰呬俊鎭笉瀛樺湪');

    const officialReward = commission.reward_source === 'official';
    const realCommissionId = commission.commission_id || commissionId;

    // ===== 鍏抽敭鍘熷瓙鎿嶄綔锛氱姸鎬佹祦杞?=====
    // 1) acceptance锛氬繀椤诲綋鍓?status='completed' 鎵嶈兘杞负 'rewarded'锛岄槻姝㈠弻閲嶅彂鏀?
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

    // 2) commission锛氬繀椤?remaining_reward >= points 鎵嶆墸鍑?
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
      // 鏋佺绔炴€侊細鍥炴粴 acceptance 鐘舵€?
      await db.collection('commission_acceptances').doc(acceptanceId).update({
        data: { status: 'completed', reward_points: 0, rewarded_at: '', updated_at: db.serverDate() }
      });
      return fail('委托剩余奖励不足，分配失败');
    }

    // 3) 棰嗗彇鑰呭姞鍒嗭紙鍘熷瓙 inc锛?
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

    // 4) 鍙戝竷鑰咃細闈炲畼鏂瑰鎵樻墠瑙ｅ喕+璁″叆宸茬敤
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

    // 5) 濮旀墭鏁翠綋宸插垎閰嶅畬 鈫?鏍囪 resolved
    const nextRemainingReward = remainingReward - points;
    if (nextRemainingReward <= 0) {
      await db.collection('commissions').doc(realCommissionId).update({
        data: { status: 'resolved', resolved_at: db.serverDate(), updated_at: db.serverDate() }
      });
    }

    // 6) 鍐欏垎閰嶈褰?+ 绉垎娴佹按
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
      reason: `濮旀墭濂栧姳 - ${commission.title || ''}`
    });

    return ok({ remaining_reward: nextRemainingReward }, '濂栧姳鍒嗛厤鎴愬姛');
  } catch (error) {
    return fail('鍒嗛厤澶辫触: ' + error.message);
  }
}

async function commission_getMyCommissions(event) {
  try {
    const user = await getCurrentUser();
    if (!user) return ok({ published: [], accepted: [], page: 1, page_size: 20 }, '鑾峰彇鎴愬姛');

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

    return ok({ published, accepted, page, page_size }, '鑾峰彇鎴愬姛');
  } catch (error) {
    if (isCollectionMissing(error)) return ok({ published: [], accepted: [], page: 1, page_size: 20 }, '鑾峰彇鎴愬姛');
    return fail('鑾峰彇鎴戠殑濮旀墭澶辫触: ' + error.message);
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
  if (!handler) return fail(`鏈煡鎿嶄綔: ${action}`);
  return handler({ ...data }, context);
};
