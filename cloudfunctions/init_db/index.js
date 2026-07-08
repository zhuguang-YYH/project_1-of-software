// 云函数入口- 数据库初始化
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * 初始化数据库集合和测试数据
 */
exports.main = async (event, context) => {
  try {
    const wx_context = cloud.getWXContext();
    const openid = wx_context.OPENID || '';
    const bootstrap = String(process.env.BOOTSTRAP_ADMIN_OPENID || '').trim();
    let allowed = false;
    if (bootstrap && bootstrap === openid) {
      allowed = true;
    } else if (openid) {
      try {
        const res = await db.collection('users').where({ openid }).limit(1).get();
        if (res.data[0] && res.data[0].role === 'admin') allowed = true;
      } catch (e) { /* users 集合可能尚未创建，跳过 */ }
    }
    if (!allowed) {
      return { code: 'PERMISSION_DENIED', message: '仅管理员或 BOOTSTRAP_ADMIN_OPENID 可执行数据库初始化' };
    }

    const { cleanupLegacyFields = false } = event || {};
    console.log('开始初始化数据库...');

    // 1. 创建集合并添加测试数据
    await initUsers();
    await initProfileCards();
    await initPointAccounts();
    await initPuzzles();
    await initActivities();
    await initBorrowRecords();
    await initExchangeRecords();
    await initInventoryItems();
    await initDudKeywords();
    await initDudRules();
    await initFeedback();
    await initRecommendations();
    await initCommissions();
    await initAdminLogs();
    await initRankingSnapshots();
    await initSystemSettings();
    await initDatingCollections();

    if (cleanupLegacyFields) {
      await cleanupLegacyDatabaseFields();
    }

    console.log('数据库初始化完成');
    return {
      code: 0,
      message: '数据库初始化成功'
    };
  } catch (error) {
    console.error('数据库初始化失败:', error);
    return {
      code: -1,
      message: '数据库初始化失败: ' + error.message,
      error: error.toString()
    };
  }
};

/**
 * 初始化用户表
 */
async function initUsers() {
  try {
    // 添加测试用户
    const users = [
      {
        openid: 'test_user_001',
        nickname: '积分小王',
        avatar_url: '',
        role: 'user',
        status: 'active',
        total_points: 500,
        available_points: 300,
        frozen_points: 200,
        used_points: 0,
        created_at: new Date(),
        updated_at: new Date(),
        last_login_at: new Date()
      },
      {
        openid: 'test_user_002',
        nickname: '排行榜第一',
        avatar_url: '',
        role: 'user',
        status: 'active',
        total_points: 1000,
        available_points: 800,
        frozen_points: 200,
        used_points: 0,
        created_at: new Date(),
        updated_at: new Date(),
        last_login_at: new Date()
      },
      {
        openid: 'test_user_003',
        nickname: '活跃用户',
        avatar_url: '',
        role: 'user',
        status: 'active',
        total_points: 750,
        available_points: 500,
        frozen_points: 250,
        used_points: 0,
        created_at: new Date(),
        updated_at: new Date(),
        last_login_at: new Date()
      }
    ];

    for (const user of users) {
      try {
        const res = await db.collection('users').where({ openid: user.openid }).get();
        if (res.data.length === 0) {
          await db.collection('users').add({ data: user });
          console.log(`✅ 用户 ${user.nickname} 添加成功`);
        }
      } catch (e) {
        // 集合不存在，直接添加会自动创建
        if (e.errCode === -502005 || e.message.includes('not exist')) {
          await db.collection('users').add({ data: user });
          console.log(`✅ 用户 ${user.nickname} 添加成功`);
        } else {
          throw e;
        }
      }
    }
  } catch (error) {
    console.log('用户表初始化:', error.message);
  }
}

const LEGACY_FIELD_CLEANUP = {
  users: [
    'nickName',
    'avatarUrl',
    'signature',
    'self_intro',
    'interests',
    'campus',
    'grade',
    'major',
    'favoriteWorks',
    'favorite_works',
    'cardStyle',
    'card_style',
    'visibility',
    'totalPoints',
    'availablePoints',
    'frozenPoints',
    'usedPoints',
    'createTime',
    'updateTime',
    'lastLoginAt'
  ],
  point_accounts: [
    'openid',
    'userId',
    'totalPoints',
    'availablePoints',
    'frozenPoints',
    'usedPoints',
    'createTime',
    'updateTime'
  ],
  points_log: [
    'openid',
    'userId',
    'changeAmount',
    'pointType',
    'businessType',
    'relatedId',
    'createTime'
  ],
  puzzles: [
    'publishDate',
    'correctAnswer',
    'answerExplanation',
    'rewardPoints',
    'publishTime',
    'createdBy',
    'createTime',
    'updateTime'
  ],
  puzzle_options: [
    'puzzleId',
    'optionLabel',
    'optionContent',
    'isCorrect',
    'sortOrder',
    'createTime',
    'updateTime'
  ],
  puzzle_answers: [
    'userId',
    'puzzleId',
    'selectedAnswer',
    'selectedOptionId',
    'isCorrect',
    'scoreGained',
    'answerDate',
    'answeredAt',
    'createTime'
  ],
  activities: [
    'registeredCount',
    'cancelDeadline',
    'startTime',
    'endTime',
    'createdBy',
    'createTime',
    'updateTime'
  ],
  activity_registrations: [
    'openid',
    'userId',
    'activityId',
    'registerTime',
    'registeredAt',
    'cancelTime',
    'cancelledAt',
    'canNotCancelConfirm',
    'createTime',
    'updateTime'
  ],
  commissions: [
    'openid',
    'publisherId',
    'publisherName',
    'rewardPoints',
    'reward',
    'description',
    'remainingReward',
    'frozenReward',
    'acceptedCount',
    'completedCount',
    'isPinned',
    'resolvedAt',
    'createTime',
    'updateTime'
  ],
  commission_acceptances: [
    'openid',
    'commissionId',
    'receiverId',
    'receiverName',
    'publisherId',
    'acceptTime',
    'acceptedAt',
    'completeTime',
    'completedAt',
    'rewardPoints',
    'rewardTime',
    'createTime',
    'updateTime'
  ],
  commission_allocations: [
    'receiverOpenid',
    'receiver_openid',
    'commissionId',
    'acceptanceId',
    'receiverId',
    'allocatedPoints',
    'createTime'
  ],
  borrow_applications: [
    'openid',
    'applicationId',
    'itemId',
    'borrowerId',
    'requestedAt',
    'lentAt',
    'returnedAt',
    'cancelledAt',
    'handledBy',
    'createTime',
    'updateTime',
    'applyTime',
    'lentTime',
    'returnTime',
    'cancelTime'
  ],
  borrow_records: [
    'openid',
    'borrowId',
    'applicationId',
    'itemId',
    'borrowerId',
    'requestedAt',
    'lentAt',
    'returnedAt',
    'cancelledAt',
    'handledBy',
    'createTime',
    'updateTime',
    'applyTime',
    'lentTime',
    'returnTime',
    'cancelTime'
  ],
  exchange_records: [
    'openid',
    'userId',
    'itemId',
    'goodsId',
    'pointsCost',
    'totalCost',
    'unitCost',
    'exchangeTime',
    'handledBy',
    'handledAt',
    'handledTime',
    'completeTime',
    'cancelTime',
    'createTime',
    'updateTime'
  ],
  ranking_snapshots: [
    'rankingDate',
    'userId',
    'rankNo',
    'totalPoints',
    'isTop100',
    'createTime'
  ],
  system_settings: [
    'settingKey',
    'settingValue',
    'createTime',
    'updateTime'
  ],
  admin_logs: [
    'adminOpenid',
    'admin_openid',
    'adminId',
    'targetId',
    'createTime'
  ],
  profile_cards: [
    'openid',
    'userId',
    'displayName',
    'selfIntro',
    'favoriteWorks',
    'cardStyle',
    'avatarUrl',
    'createTime',
    'updateTime'
  ],
  inventory_items: [
    'legacyCollection',
    'legacyId',
    'itemName',
    'itemType',
    'totalQuantity',
    'availableQuantity',
    'quantity',
    'stock',
    'exchangePoints',
    'cost',
    'coverUrl',
    'minPlayers',
    'maxPlayers',
    'playerRange',
    'durationMinutes',
    'exchangedCount',
    'borrowCount',
    'currentBorrower',
    'currentBorrowerId',
    'currentApplicationId',
    'createTime',
    'updateTime'
  ],
  dud_keywords: [
    'ruleName',
    'replyContent',
    'matchType',
    'isEnabled',
    'createdBy',
    'createTime',
    'updateTime'
  ],
  dud_messages: [
    'message',
    'content',
    'type',
    'matchedKeyword',
    'matched_keyword',
    'matchType',
    'match_type',
    'ruleId',
    'rule_id',
    'createTime'
  ],
  feedback: [
    'userId',
    'nickName',
    'nickname',
    'feedbackType',
    'anonymous',
    'isAnonymous',
    'adminRemark',
    'handledBy',
    'handledAt',
    'createTime',
    'updateTime'
  ],
  recommendations: [
    'name',
    'recommenderId',
    'recommenderName',
    'articleUrl',
    'linkUrl',
    'coverUrl',
    'publishedAt',
    'createTime',
    'updateTime'
  ]
};

async function cleanupCollectionLegacyFields(collectionName, legacyFields) {
  try {
    const page_size = 100;
    let page = 0;
    let count = 0;

    while (true) {
      const res = await db.collection(collectionName).skip(page * page_size).limit(page_size).get();
      const list = res.data || [];
      if (list.length === 0) break;

      for (const item of list) {
        const data = {};
        legacyFields.forEach(field => {
          if (Object.prototype.hasOwnProperty.call(item, field)) {
            data[field] = _.remove();
          }
        });

        if (Object.keys(data).length > 0) {
          await db.collection(collectionName).doc(item._id).update({ data });
          count += 1;
        }
      }

      if (list.length < page_size) break;
      page += 1;
    }

    console.log(`${collectionName} legacy fields cleaned: ${count}`);
    return count;
  } catch (error) {
    console.log(`${collectionName} legacy cleanup skipped:`, error.message);
    return 0;
  }
}

async function cleanupLegacyDatabaseFields() {
  console.log('开始清理第一批旧字段...');
  const result = {};
  for (const collectionName of Object.keys(LEGACY_FIELD_CLEANUP)) {
    result[collectionName] = await cleanupCollectionLegacyFields(
      collectionName,
      LEGACY_FIELD_CLEANUP[collectionName]
    );
  }
  console.log('第二批旧字段清理完成', result);
  return result;
}

/**
 * 初始化个人名片表
 */
async function initProfileCards() {
  try {
    const userRes = await db.collection('users').limit(100).get();

    for (const user of userRes.data || []) {
      const nickName = user.nickName || user.nickname || '侦探';
      const avatarUrl = user.avatarUrl || user.avatar_url || '';
      const selfIntro = user.signature || user.self_intro || '';
      let exists = false;

      try {
        const existRes = await db.collection('profile_cards').where({ user_id: user._id }).limit(1).get();
        exists = existRes.data.length > 0;
      } catch (e) {
        exists = false;
      }

      if (exists) continue;

      await db.collection('profile_cards').add({
        data: {
          user_id: user._id,
          display_name: nickName,
          campus: '',
          grade: '',
          major: '',
          interests: user.interests || [],
          self_intro: selfIntro,
          favorite_works: [],
          card_style: {},
          visibility: 'public',
          avatar_url: avatarUrl,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
      console.log(`✅ 个人名片 ${nickName} 添加成功`);
    }
  } catch (error) {
    console.log('个人名片表初始化:', error.message);
  }
}

/**
 * 初始化积分账户表
 */
async function initPointAccounts() {
  try {
    const userRes = await db.collection('users').limit(100).get();

    for (const user of userRes.data || []) {
      let exists = false;
      try {
        const existRes = await db.collection('point_accounts').where({ user_id: user._id }).limit(1).get();
        exists = existRes.data.length > 0;
      } catch (e) {
        exists = false;
      }

      if (exists) continue;

      const total_points = Number(user.total_points || 0);
      const available_points = Number(user.available_points || 0);
      const frozen_points = Number(user.frozen_points || 0);
      const used_points = Number(user.used_points || 0);

      await db.collection('point_accounts').add({
        data: {
          user_id: user._id,
          total_points,
          available_points,
          frozen_points,
          used_points,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
      console.log(`✅ 积分账户 ${user.nickName || user.nickname || user.openid} 添加成功`);
    }
  } catch (error) {
    console.log('积分账户表初始化:', error.message);
  }
}

/**
 * 初始化每日谜题
 */
async function initPuzzles() {
  try {
    const puzzles = [
      {
        date: new Date().toISOString().split('T')[0],
        publish_date: new Date().toISOString().split('T')[0],
        title: '每日谜题',
        question: '以下哪个选项是正确的？',
        content: '以下哪个选项是正确的？',
        options: ['选项A', '选项B', '选项C', '选项D'],
        correct_answer: '选项B',
        explanation: '这是正确答案的解释说明。',
        answer_explanation: '这是正确答案的解释说明。',
        difficulty: 'easy',
        reward_points: 10,
        publish_time: '',
        status: 'published',
        created_by: 'system',
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    for (const puzzle of puzzles) {
      const res = await db.collection('puzzles').where({ date: puzzle.date }).get();
      let puzzleId = '';
      if (res.data.length === 0) {
        const addRes = await db.collection('puzzles').add({ data: puzzle });
        puzzleId = addRes._id;
        console.log(`✅ 谜题 ${puzzle.date} 添加成功`);
      } else {
        puzzleId = res.data[0]._id;
      }

      await syncPuzzleOptions(puzzleId, puzzle.options, puzzle.correct_answer);
    }
  } catch (error) {
    console.log('谜题表初始化:', error.message);
  }
}

async function syncPuzzleOptions(puzzleId, options, correctAnswer) {
  if (!puzzleId || !Array.isArray(options)) return;

  try {
    const existRes = await db.collection('puzzle_options').where({ puzzle_id: puzzleId }).limit(100).get();
    if (existRes.data.length > 0) return;
  } catch (error) {
    // 集合不存在时继续创建。
  }

  for (let index = 0; index < options.length; index += 1) {
    const content = options[index];
    const label = String.fromCharCode(65 + index);
    await db.collection('puzzle_options').add({
      data: {
        puzzle_id: puzzleId,
        option_label: label,
        option_content: content,
        content,
        is_correct: content === correctAnswer,
        sort_order: index,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }
  console.log(`✅ 谜题选项 ${puzzleId} 添加成功`);
}

/**
 * 初始化活动
 */
async function initActivities() {
  try {
    const activities = [
      {
        title: '春季趣味运动会',
        description: '参加春季运动会，赢取奖品！',
        location: '校运动场',
        capacity: 100,
        registered_count: 98,
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        start_time: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'recruiting',
        created_by: 'system',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        title: '暑期夏令营',
        description: '参加暑期夏令营，体验大自然',
        location: '山区营地',
        capacity: 50,
        registered_count: 48,
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        start_time: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 27 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'recruiting',
        created_by: 'system',
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    for (const activity of activities) {
      try {
        const res = await db.collection('activities').where({ title: activity.title }).get();
        if (res.data.length === 0) {
          await db.collection('activities').add({ data: activity });
          console.log(`✅ 活动 ${activity.title} 添加成功`);
        } else {
          await db.collection('activities').doc(res.data[0]._id).update({
            data: {
              registered_count: res.data[0].registered_count || res.data[0].registeredCount || 0,
              cancel_deadline: res.data[0].cancel_deadline || res.data[0].cancelDeadline || res.data[0].deadline || '',
              start_time: res.data[0].start_time || res.data[0].startTime || '',
              end_time: res.data[0].end_time || res.data[0].endTime || '',
              created_by: res.data[0].created_by || res.data[0].createdBy || 'system',
              updated_at: new Date()
            }
          });
        }
      } catch (e) {
        if (e.errCode === -502005 || e.message.includes('not exist')) {
          await db.collection('activities').add({ data: activity });
          console.log(`✅ 活动 ${activity.title} 添加成功`);
        } else {
          throw e;
        }
      }
    }
  } catch (error) {
    console.log('活动表初始化:', error.message);
  }
}

/**
 * 初始化物资借阅
 */
async function initInventoryItems() {
  try {
    const items = [
      {
        name: '帐篷',
        item_name: '帐篷',
        item_type: 'material',
        description: '2人防水露营帐篷',
        category: '露营',
        total_quantity: 10,
        available_quantity: 10,
        status: 'available',
        exchange_points: 0,
        cover_url: '',
        image: '',
        borrow_count: 0,
        exchanged_count: 0,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        name: '剧本杀体验券',
        item_name: '剧本杀体验券',
        item_type: 'exchange_good',
        description: '社团活动兑换奖品',
        category: 'activity',
        total_quantity: 20,
        available_quantity: 20,
        status: 'available',
        exchange_points: 100,
        original_cost: 100,
        cover_url: '',
        image: '',
        borrow_count: 0,
        exchanged_count: 0,
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    for (const item of items) {
      const res = await db.collection('inventory_items').where({ name: item.name, item_type: item.item_type }).limit(1).get();
      if (res.data.length === 0) {
        await db.collection('inventory_items').add({ data: item });
        console.log(`inventory item ${item.name} added`);
      }
    }
  } catch (error) {
    console.log('统一库存表初始化:', error.message);
  }
}

/**
 * 对齐兑换记录字段
 */
async function initExchangeRecords() {
  try {
    const res = await db.collection('exchange_records').limit(100).get();
    for (const item of res.data || []) {
      const id = item.exchange_id || item._id;
      const item_id = item.item_id || '';
      const points_cost = Number(item.points_cost || 0);
      const created_at = item.created_at || new Date();
      const handled_at = item.handled_at || '';
      const handled_by = item.handled_by || '';
      await db.collection('exchange_records').doc(item._id).update({
        data: {
          exchange_id: id,
          user_id: item.user_id || '',
          item_id,
          points_cost,
          total_cost: Number(item.total_cost || points_cost),
          quantity: Number(item.quantity || 1),
          handled_by,
          handled_at,
          created_at,
          exchange_time: item.exchange_time || created_at,
          updated_at: item.updated_at || created_at
        }
      });
    }
    console.log('兑换记录字段对齐完成');
  } catch (error) {
    console.log('兑换记录字段对齐:', error.message);
  }
}

/**
 * 对齐借阅记录字段
 */
async function initBorrowRecords() {
  try {
    const appRes = await db.collection('borrow_applications').limit(100).get();
    for (const item of appRes.data || []) {
      const id = item.borrow_id || item.application_id || item._id;
      const item_id = item.item_id || '';
      const borrower_id = item.borrower_id || item.user_id || '';
      const requested_at = item.requested_at || new Date();
      const lent_at = item.lent_at || '';
      const returned_at = item.returned_at || '';
      const cancelled_at = item.cancelled_at || '';
      const handled_by = item.handled_by || '';
      const updateData = {
        borrow_id: id,
        application_id: id,
        item_id,
        borrower_id,
        requested_at,
        lent_at,
        returned_at,
        cancelled_at,
        handled_by,
        created_at: item.created_at || requested_at,
        updated_at: item.updated_at || requested_at
      };

      await db.collection('borrow_applications').doc(item._id).update({ data: updateData });

      try {
        const recordRes = await db.collection('borrow_records').where({ application_id: id }).limit(1).get();
        if (recordRes.data.length > 0) {
          await db.collection('borrow_records').doc(recordRes.data[0]._id).update({
            data: updateData
          });
        } else {
          await db.collection('borrow_records').add({
            data: updateData
          });
        }
      } catch (e) {
        console.log('借阅记录同步 borrow_records:', e.message);
      }
    }

    console.log('借阅记录字段对齐完成');
  } catch (error) {
    console.log('借阅记录字段对齐:', error.message);
  }
}

/**
 * 初始化 DUD 关键词
 */
async function initDudKeywords() {
  try {
    const keywords = [
      {
        keyword: '你好',
        reply: '你好！很高兴认识你~ 😊',
        match_type: 'exact',
        created_at: new Date()
      },
      {
        keyword: '谢谢',
        reply: '不客气！很高兴为你服务 👍',
        match_type: 'exact',
        created_at: new Date()
      },
      {
        keyword: '帮助',
        reply: '我可以帮助你了解应用的各项功能，有什么需要帮助的吗？',
        match_type: 'exact',
        created_at: new Date()
      },
      {
        keyword: '积分',
        reply: '可以通过完成每日谜题、参加活动等方式获得积分哦！',
        match_type: 'fuzzy',
        created_at: new Date()
      },
      {
        keyword: '排行',
        reply: '前往「排行榜」页面可以查看实时排名情况~',
        match_type: 'fuzzy',
        created_at: new Date()
      }
    ];

    for (const keyword of keywords) {
      try {
        const res = await db.collection('dud_keywords').where({ keyword: keyword.keyword }).get();
        if (res.data.length === 0) {
          await db.collection('dud_keywords').add({ data: keyword });
          console.log(`✅ 关键词 "${keyword.keyword}" 添加成功`);
        }
      } catch (e) {
        if (e.errCode === -502005 || e.message.includes('not exist')) {
          await db.collection('dud_keywords').add({ data: keyword });
          console.log(`✅ 关键词 "${keyword.keyword}" 添加成功`);
        } else {
          throw e;
        }
      }
    }
  } catch (error) {
    console.log('DUD关键词表初始化:', error.message);
  }
}

/**
 * 对齐 Dud 关键词规则字段
 */
async function initDudRules() {
  try {
    const res = await db.collection('dud_keywords').limit(100).get();

    for (const item of res.data || []) {
      const keywords = Array.isArray(item.keywords)
        ? item.keywords.map(keyword => String(keyword || '').trim()).filter(Boolean)
        : String(item.keyword || '').split(/[,，\n]/).map(keyword => keyword.trim()).filter(Boolean);
      const firstKeyword = keywords[0] || item.keyword || '关键词';
      const reply_content = item.reply_content || item.reply || '';
      const match_type = item.match_type || 'exact';
      const created_at = item.created_at || new Date();
      const updated_at = item.updated_at || created_at;

      await db.collection('dud_keywords').doc(item._id).update({
        data: {
          rule_name: item.rule_name || firstKeyword,
          keyword: item.keyword || firstKeyword,
          keywords,
          reply: item.reply || reply_content,
          reply_content,
          match_type,
          priority: Number(item.priority || 0),
          is_enabled: item.is_enabled !== false,
          created_by: item.created_by || 'system',
          created_at,
          updated_at
        }
      });
    }

    console.log('Dud 关键词规则字段对齐完成');
  } catch (error) {
    console.log('Dud 关键词规则字段对齐:', error.message);
  }
}

/**
 * 对齐反馈表字段
 */
async function initFeedback() {
  try {
    const res = await db.collection('feedback').limit(100).get();

    for (const item of res.data || []) {
      const feedback_type = item.feedback_type || item.type || 'general';
      const is_anonymous = item.is_anonymous === true;
      const admin_remark = item.admin_remark || item.reply || '';
      const created_at = item.created_at || new Date();
      const updated_at = item.updated_at || created_at;
      const handled_by = item.handled_by || '';
      const handled_at = item.handled_at || '';

      await db.collection('feedback').doc(item._id).update({
        data: {
          user_id: item.user_id || '',
          type: item.type || feedback_type,
          feedback_type,
          is_anonymous,
          admin_remark,
          handled_by,
          handled_at,
          created_at,
          updated_at
        }
      });
    }

    console.log('反馈表字段对齐完成');
  } catch (error) {
    console.log('反馈表初始化:', error.message);
  }
}

/**
 * 对齐推荐内容表字段
 */
async function initRecommendations() {
  try {
    const res = await db.collection('recommendations').limit(100).get();

    for (const item of res.data || []) {
      const title = item.title || '推荐内容';
      const recommender_name = item.recommender_name || item.recommender || 'NK推协';
      const article_url = item.article_url || item.link_url || '';
      const cover_url = item.cover_url || item.image || '';
      const published_at = item.published_at || item.created_at || new Date();
      const created_at = item.created_at || published_at;
      const updated_at = item.updated_at || created_at;

      await db.collection('recommendations').doc(item._id).update({
        data: {
          recommendation_id: item.recommendation_id || item._id,
          title,
          category: item.category || item.type || 'general',
          genre: item.genre || '',
          recommender_id: item.recommender_id || '',
          recommender_name,
          reason: item.reason || item.description || item.summary || '',
          article_url,
          link_url: item.link_url || article_url,
          cover_url,
          status: item.status || 'published',
          published_at,
          created_at,
          updated_at
        }
      });
    }

    console.log('推荐内容表字段对齐完成');
  } catch (error) {
    console.log('推荐内容表初始化:', error.message);
  }
}

/**
 * 对齐事件委托相关字段
 */
async function initCommissions() {
  try {
    const commissionRes = await db.collection('commissions').limit(100).get();
    for (const item of commissionRes.data || []) {
      const reward_points = Number(item.reward_points || item.reward || 0);
      const remaining_reward = Number(item.remaining_reward !== undefined ? item.remaining_reward : reward_points);
      const content = item.content || '';
      const created_at = item.created_at || new Date();
      const updated_at = item.updated_at || created_at;
      const resolved_at = item.resolved_at || '';

      await db.collection('commissions').doc(item._id).update({
        data: {
          commission_id: item.commission_id || item._id,
          publisher_id: item.publisher_id || '',
          publisher_name: item.publisher_name || '',
          content,
          reward_points,
          remaining_reward,
          frozen_reward: Number(item.frozen_reward || reward_points),
          accepted_count: Number(item.accepted_count || 0),
          completed_count: Number(item.completed_count || 0),
          is_pinned: item.is_pinned === true,
          resolved_at,
          created_at,
          updated_at
        }
      });
    }

    const acceptanceRes = await db.collection('commission_acceptances').limit(100).get();
    for (const item of acceptanceRes.data || []) {
      const commission_id = item.commission_id || '';
      const accepted_at = item.accepted_at || new Date();
      const completed_at = item.completed_at || '';
      const updated_at = item.updated_at || accepted_at;

      await db.collection('commission_acceptances').doc(item._id).update({
        data: {
          acceptance_id: item.acceptance_id || item._id,
          commission_id,
          receiver_id: item.receiver_id || '',
          receiver_name: item.receiver_name || '',
          accepted_at,
          completed_at,
          created_at: item.created_at || accepted_at,
          updated_at
        }
      });
    }

    const allocationRes = await db.collection('commission_allocations').limit(100).get();
    for (const item of allocationRes.data || []) {
      const commission_id = item.commission_id || '';
      const receiver_id = item.receiver_id || '';
      const allocated_points = Number(item.allocated_points || 0);
      const created_at = item.created_at || new Date();

      await db.collection('commission_allocations').doc(item._id).update({
        data: {
          allocation_id: item.allocation_id || item._id,
          commission_id,
          acceptance_id: item.acceptance_id || '',
          receiver_id,
          allocated_points,
          created_at
        }
      });
    }

    console.log('事件委托字段对齐完成');
  } catch (error) {
    console.log('事件委托字段对齐:', error.message);
  }
}

/**
 * 对齐后台操作日志字段
 */
async function initAdminLogs() {
  try {
    const res = await db.collection('admin_logs').limit(100).get();

    for (const item of res.data || []) {
      const admin_id = item.admin_id || '';
      const operation_type = item.operation_type || '';
      const target_collection = item.target_collection || '';
      const target_id = item.target_id || '';
      const before_data = item.before_data !== undefined ? item.before_data : null;
      const after_data = item.after_data !== undefined ? item.after_data : null;
      const created_at = item.created_at || new Date();

      await db.collection('admin_logs').doc(item._id).update({
        data: {
          log_id: item.log_id || item._id,
          admin_id,
          operation_type,
          target_collection,
          target_id,
          before_data,
          after_data,
          created_at
        }
      });
    }

    console.log('后台操作日志字段对齐完成');
  } catch (error) {
    console.log('后台操作日志字段对齐:', error.message);
  }
}

/**
 * 生成或对齐排行榜快照
 */
async function initRankingSnapshots() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const usersRes = await db.collection('users').orderBy('total_points', 'desc').limit(100).get();
    for (let index = 0; index < (usersRes.data || []).length; index += 1) {
      const user = usersRes.data[index];
      const rank_no = index + 1;
      const user_id = user._id || user.user_id || '';
      const total_points = Number(user.total_points || 0);
      const data = {
        ranking_date: today,
        user_id,
        rank_no,
        total_points,
        is_top100: true,
        created_at: new Date()
      };
      const existRes = await db.collection('ranking_snapshots').where({ ranking_date: today, user_id }).limit(1).get();
      if (existRes.data.length > 0) {
        await db.collection('ranking_snapshots').doc(existRes.data[0]._id).update({ data });
      } else {
        const addRes = await db.collection('ranking_snapshots').add({ data });
        await db.collection('ranking_snapshots').doc(addRes._id).update({ data: { snapshot_id: addRes._id } });
      }
    }
    console.log('排行榜快照字段对齐完成');
  } catch (error) {
    console.log('排行榜快照字段对齐:', error.message);
  }
}

/**
 * 对齐系统设置字段
 */
async function initSystemSettings() {
  try {
    const defaultSettings = {
      puzzle_publish_time: '09:00',
      default_puzzle_reward: 10,
      activity_cancel_hours: 24,
      recommendation_enabled: true,
      commission_enabled: true
    };
    const res = await db.collection('system_settings').where({ key: 'global' }).limit(1).get();
    if (res.data.length > 0) {
      const item = res.data[0];
      const settings = { ...defaultSettings, ...(item.settings || {}) };
      await db.collection('system_settings').doc(item._id).update({
        data: {
          setting_id: item.setting_id || item._id,
          key: 'global',
          setting_key: 'global',
          settings,
          setting_value: settings,
          description: item.description || '系统全局设置',
          created_at: item.created_at || new Date(),
          updated_at: new Date()
        }
      });
    } else {
      const addRes = await db.collection('system_settings').add({
        data: {
          key: 'global',
          setting_key: 'global',
          settings: defaultSettings,
          setting_value: defaultSettings,
          description: '系统全局设置',
          created_at: new Date(),
          updated_at: new Date()
        }
      });
      await db.collection('system_settings').doc(addRes._id).update({ data: { setting_id: addRes._id } });
    }
    console.log('系统设置字段对齐完成');
  } catch (error) {
    console.log('系统设置字段对齐:', error.message);
  }
}

/**
 * 初始化交友相关集合（dating_matches, dating_swipes, dating_pool, dating_preferences, game_invitations, friend_messages）
 */
async function initDatingCollections() {
  const collections = [
    'dating_matches',
    'dating_swipes',
    'dating_pool',
    'dating_preferences',
    'game_invitations',
    'friend_messages',
    'friend_requests'
  ];

  for (const name of collections) {
    try {
      // 尝试查询以检查集合是否存在，不存在则通过 add+remove 触发创建
      try {
        await db.collection(name).limit(1).get();
        console.log(`✅ 集合 ${name} 已存在`);
      } catch (e) {
        if (e.errCode === -502005 || String(e.message || '').includes('not exist')) {
          // 插入一个占位文档来创建集合
          const addRes = await db.collection(name).add({
            data: {
              _placeholder: true,
              created_at: new Date()
            }
          });
          // 立即删除占位文档
          await db.collection(name).doc(addRes._id).remove();
          console.log(`✅ 集合 ${name} 已创建`);
        } else {
          throw e;
        }
      }
    } catch (error) {
      console.log(`集合 ${name} 初始化:`, error.message);
    }
  }
}


