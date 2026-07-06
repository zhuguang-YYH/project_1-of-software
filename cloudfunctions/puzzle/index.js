const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// Configure this with the template ID created in the WeChat public platform.
const PUZZLE_DAILY_REMINDER_TMPL = process.env.PUZZLE_DAILY_REMINDER_TMPL || '';
const PUZZLE_REMINDER_MAX_PER_RUN = 500;
const PUZZLE_STREAK_BONUS_DAYS = Math.max(2, Number(process.env.PUZZLE_STREAK_BONUS_DAYS) || 3);
const PUZZLE_STREAK_BONUS_POINTS = Math.max(0, Number(process.env.PUZZLE_STREAK_BONUS_POINTS) || 5);

function success(data = null, message = '操作成功') {
  return { code: 0, data, message };
}

function fail(message = '操作失败') {
  return { code: -1, message };
}

function isCollectionMissing(error) {
  return error && (
    error.errCode === -502005 ||
    String(error.message || '').includes('not exist') ||
    String(error.message || '').includes('collection not exists')
  );
}

function todayText() {
  return new Date().toISOString().split('T')[0];
}

function shiftDateText(dateText, deltaDays) {
  const ts = Date.parse(`${dateText}T00:00:00Z`);
  if (Number.isNaN(ts)) return '';
  return new Date(ts + deltaDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function asThing(value, max = 20) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : '—';
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

function numberValue(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeOption(item = {}, index = 0) {
  const option_label = item.option_label || String.fromCharCode(65 + index);
  const option_content = item.option_content || item.content || '';
  const option_id = item.option_id || item._id || option_content;

  return {
    option_id,
    option_label,
    option_content,
    is_correct: !!item.is_correct,
    sort_order: numberValue(item.sort_order, index)
  };
}

function normalizeAnswerRecord(item = {}) {
  return {
    answer_id: item.answer_id || item._id || '',
    puzzle_id: item.puzzle_id || '',
    user_id: item.user_id || '',
    answer_date: item.answer_date || '',
    selected_answer: item.selected_answer || '',
    selected_option_id: item.selected_option_id || '',
    is_correct: !!item.is_correct,
    score_gained: numberValue(item.score_gained, 0),
    streak_days: numberValue(item.streak_days, 0),
    streak_bonus_points: numberValue(item.streak_bonus_points, 0),
    total_score_gained: numberValue(item.total_score_gained || item.score_gained, 0),
    answered_at: item.answered_at || item.created_at || '',
    created_at: item.created_at || ''
  };
}

function normalizePuzzle(puzzle, options, answer_record, streak_stats = {}) {
  const puzzle_id = puzzle.puzzle_id || puzzle._id;
  const user_answer = answer_record ? answer_record.selected_answer : '';
  const correct_option = options.find(item => item.is_correct);

  return {
    puzzle_id,
    title: puzzle.title || '',
    content: puzzle.content || '',
    difficulty: puzzle.difficulty || 'normal',
    publish_date: puzzle.publish_date || '',
    reward_points: numberValue(puzzle.reward_points, 10),
    answer_explanation: puzzle.answer_explanation || '',
    status: puzzle.status || 'published',
    options: options.map(item => ({
      option_id: item.option_id,
      option_label: item.option_label,
      option_content: item.option_content,
      sort_order: item.sort_order
    })),
    answered: !!answer_record,
    user_answer,
    selected_option_id: answer_record ? answer_record.selected_option_id : '',
    is_correct: answer_record ? !!answer_record.is_correct : false,
    correct_answer: answer_record && correct_option ? correct_option.option_content : '',
    current_streak: numberValue(streak_stats.current_streak, 0),
    streak_bonus_days: PUZZLE_STREAK_BONUS_DAYS,
    streak_bonus_points: PUZZLE_STREAK_BONUS_POINTS,
    next_streak_bonus_in: numberValue(streak_stats.next_streak_bonus_in, PUZZLE_STREAK_BONUS_DAYS),
    last_streak_bonus_points: answer_record ? numberValue(answer_record.streak_bonus_points, 0) : 0,
    total_score_gained: answer_record ? numberValue(answer_record.total_score_gained || answer_record.score_gained, 0) : 0
  };
}

async function getCurrentUser(openid) {
  if (!openid) return null;
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function getPuzzleOptions(puzzle) {
  try {
    const res = await db.collection('puzzle_options')
      .where({ puzzle_id: puzzle._id })
      .orderBy('sort_order', 'asc')
      .get();

    if (res.data.length > 0) {
      return res.data.map(normalizeOption);
    }
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }

  return (puzzle.options || []).map((option_content, index) => normalizeOption({
    option_content,
    is_correct: option_content === puzzle.correct_answer,
    sort_order: index
  }, index));
}

function readPoints(user = {}, account = {}) {
  return {
    total_points: numberValue(account.total_points || user.total_points, 0),
    available_points: numberValue(account.available_points || user.available_points, 0),
    frozen_points: numberValue(account.frozen_points || user.frozen_points, 0),
    used_points: numberValue(account.used_points || user.used_points, 0)
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
    ...points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  try {
    const add_res = await db.collection('point_accounts').add({ data });
    return { _id: add_res._id, ...data };
  } catch (error) {
    // _id 冲突 → 并发创建，读取已存在的记录
    if (!isCollectionMissing(error)) {
      const existed = await db.collection('point_accounts').doc(stableId).get();
      if (existed.data) return existed.data;
    }
    throw error;
  }
}

async function addPuzzlePoints(user, points, puzzle_id, options = {}) {
  if (!points || points <= 0) return;
  const reason = options.reason || '每日谜题答对奖励';
  const business_type = options.business_type || 'daily_puzzle';
  await ensurePointAccount(user);

  // 原子加分：users 表是最权威的积分来源，必须成功
  await db.collection('users').doc(user._id).update({
    data: {
      total_points: db.command.inc(points),
      available_points: db.command.inc(points),
      updated_at: db.serverDate()
    }
  });

  // point_accounts 是辅助缓存，best-effort 同步；缺失时后续 ensurePointAccount 会从 users 重建
  try {
    await db.collection('point_accounts').where({ user_id: user._id }).update({
      data: {
        total_points: db.command.inc(points),
        available_points: db.command.inc(points),
        updated_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) {
      console.warn('[puzzle] sync point_accounts failed:', error && error.message);
    }
  }

  // 积分流水日志，best-effort
  try {
    await db.collection('points_log').add({
      data: {
        user_id: user._id,
        amount: points,
        change_amount: points,
        point_type: 'available',
        type: 'income',
        business_type,
        related_id: puzzle_id,
        reason,
        description: reason,
        created_at: db.serverDate()
      }
    });
  } catch (error) {
    if (!isCollectionMissing(error)) {
      console.warn('[puzzle] add points_log failed:', error && error.message);
    }
  }
}

function calcNextStreakBonusIn(streak) {
  const current = Math.max(0, Number(streak) || 0);
  const remainder = current % PUZZLE_STREAK_BONUS_DAYS;
  return remainder === 0 ? PUZZLE_STREAK_BONUS_DAYS : PUZZLE_STREAK_BONUS_DAYS - remainder;
}

function calcActiveCorrectStreak(list, current_date) {
  const byDate = new Map();
  (list || []).forEach((item) => {
    const date = item.answer_date || '';
    if (date && !byDate.has(date)) byDate.set(date, !!item.is_correct);
  });

  if (byDate.has(current_date) && !byDate.get(current_date)) return 0;

  let cursor = byDate.get(current_date) ? current_date : shiftDateText(current_date, -1);
  let streak = 0;
  while (cursor && byDate.get(cursor) === true) {
    streak += 1;
    cursor = shiftDateText(cursor, -1);
  }
  return streak;
}

async function getPuzzleStreakStats(user, current_date = todayText()) {
  const defaults = {
    current_streak: 0,
    streak_bonus_days: PUZZLE_STREAK_BONUS_DAYS,
    streak_bonus_points: PUZZLE_STREAK_BONUS_POINTS,
    next_streak_bonus_in: PUZZLE_STREAK_BONUS_DAYS
  };
  if (!user || !user._id) return defaults;

  try {
    const res = await db.collection('puzzle_answers')
      .where({ user_id: user._id })
      .orderBy('answer_date', 'desc')
      .limit(100)
      .get();
    const current_streak = calcActiveCorrectStreak(res.data || [], current_date);
    return {
      ...defaults,
      current_streak,
      next_streak_bonus_in: calcNextStreakBonusIn(current_streak)
    };
  } catch (error) {
    if (isCollectionMissing(error)) return defaults;
    throw error;
  }
}

async function getAnswerRecord(user, puzzle_id, answer_date) {
  if (!user || !user._id) return null;
  const res = await db.collection('puzzle_answers').where({
    user_id: user._id,
    puzzle_id,
    answer_date
  }).limit(1).get();

  return res.data[0] || null;
}

async function getPuzzleByDate(publish_date) {
  // 只查每日谜题（兼容旧数据无 puzzle_type）
  const res = await db.collection('puzzles')
    .where(_.and([
      { publish_date, status: 'published' },
      _.or([
        { puzzle_type: 'daily' },
        { puzzle_type: _.exists(false) }
      ])
    ]))
    .limit(1)
    .get();

  if (res.data.length > 0) return res.data[0];

  const fallback = await db.collection('puzzles')
    .where({
      publish_date,
      puzzle_type: _.or([
        _.eq('daily'),
        _.exists(false)
      ])
    })
    .limit(1)
    .get();
  return fallback.data[0] || null;
}

async function puzzle_getTodayPuzzle() {
  try {
    const wx_context = cloud.getWXContext();
    const current_date = todayText();
    const puzzle = await getPuzzleByDate(current_date);

    if (!puzzle) return fail('今日谜题暂未发布');

    const user = await getCurrentUser(wx_context.OPENID);
    const options = await getPuzzleOptions(puzzle);
    const answer_record = await getAnswerRecord(user, puzzle._id, current_date);
    const streak_stats = await getPuzzleStreakStats(user, current_date);

    return success(normalizePuzzle(puzzle, options, answer_record, streak_stats), '获取成功');
  } catch (error) {
    return fail('获取谜题失败: ' + error.message);
  }
}

async function puzzle_submitAnswer(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const puzzle_id = event.puzzle_id;
    const selected_value = event.answer || event.option_id;

    if (!user) return fail('请先完成授权登录');
    if (!puzzle_id) return fail('缺少谜题编号');
    if (!selected_value) return fail('请选择答案');

    const current_date = todayText();

    // 幂等防重：用 user_id + puzzle_id + date 拼接成稳定 _id
    // 微信云数据库 _id 唯一，并发重复 add 第二次必失败 → 天然防重
    const stable_id = `pa_${user._id}_${puzzle_id}_${current_date}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);

    // 命中已有记录 → 直接返回历史结果（幂等）
    const existing = await getAnswerRecord(user, puzzle_id, current_date);
    if (existing) {
      const streak_stats = await getPuzzleStreakStats(user, current_date);
      return success({
        answer_id: existing._id,
        is_correct: !!existing.is_correct,
        correct_answer: '',
        answer_explanation: '',
        score_gained: numberValue(existing.score_gained, 0),
        streak_days: numberValue(existing.streak_days || streak_stats.current_streak, 0),
        current_streak: numberValue(streak_stats.current_streak, 0),
        streak_bonus_points: numberValue(existing.streak_bonus_points, 0),
        total_score_gained: numberValue(existing.total_score_gained || existing.score_gained, 0),
        streak_bonus_days: PUZZLE_STREAK_BONUS_DAYS,
        next_streak_bonus_in: numberValue(streak_stats.next_streak_bonus_in, PUZZLE_STREAK_BONUS_DAYS),
        idempotent: true
      }, '您今天已经答过这道谜题了');
    }

    const puzzle_res = await db.collection('puzzles').doc(puzzle_id).get();
    const puzzle = puzzle_res.data;
    if (!puzzle) return fail('谜题不存在');

    const options = await getPuzzleOptions(puzzle);
    const selected_option = options.find(item => (
      item.option_id === selected_value ||
      item.option_label === selected_value ||
      item.option_content === selected_value
    ));
    const selected_answer = selected_option ? selected_option.option_content : selected_value;
    const correct_option = options.find(item => item.is_correct);
    const correct_answer = correct_option ? correct_option.option_content : '';
    const is_correct = !!correct_answer && selected_answer === correct_answer;
    const score_gained = is_correct ? numberValue(puzzle.reward_points, 10) : 0;

    // 使用稳定 _id 写入：并发第二次会因 _id 冲突失败 → 防止双倍加分
    let answer_doc_id = stable_id;
    try {
      await db.collection('puzzle_answers').add({
        data: {
          _id: stable_id,
          answer_id: stable_id,
          user_id: user._id,
          puzzle_id,
          selected_answer,
          selected_option_id: selected_option ? selected_option.option_id : '',
          is_correct,
          score_gained,
          answer_date: current_date,
          answered_at: db.serverDate(),
          created_at: db.serverDate()
        }
      });
    } catch (error) {
      // _id 冲突：说明已被并发写入，幂等返回
      const dup = await getAnswerRecord(user, puzzle_id, current_date);
      if (dup) {
        const streak_stats = await getPuzzleStreakStats(user, current_date);
        return success({
          answer_id: dup._id,
          is_correct: !!dup.is_correct,
          correct_answer,
          answer_explanation: puzzle.answer_explanation || '',
          score_gained: numberValue(dup.score_gained, 0),
          streak_days: numberValue(dup.streak_days || streak_stats.current_streak, 0),
          current_streak: numberValue(streak_stats.current_streak, 0),
          streak_bonus_points: numberValue(dup.streak_bonus_points, 0),
          total_score_gained: numberValue(dup.total_score_gained || dup.score_gained, 0),
          streak_bonus_days: PUZZLE_STREAK_BONUS_DAYS,
          next_streak_bonus_in: numberValue(streak_stats.next_streak_bonus_in, PUZZLE_STREAK_BONUS_DAYS),
          idempotent: true
        }, '您今天已经答过这道谜题了');
      }
      throw error;
    }

    const streak_stats = await getPuzzleStreakStats(user, current_date);
    const streak_days = is_correct ? streak_stats.current_streak : 0;
    const streak_bonus_points = is_correct &&
      PUZZLE_STREAK_BONUS_POINTS > 0 &&
      streak_days > 0 &&
      streak_days % PUZZLE_STREAK_BONUS_DAYS === 0
      ? PUZZLE_STREAK_BONUS_POINTS
      : 0;
    const total_score_gained = score_gained + streak_bonus_points;

    if (score_gained > 0) {
      await addPuzzlePoints(user, score_gained, puzzle_id);
    }
    if (streak_bonus_points > 0) {
      await addPuzzlePoints(user, streak_bonus_points, puzzle_id, {
        business_type: 'daily_puzzle_streak',
        reason: `连续答对 ${streak_days} 天奖励`
      });
    }

    try {
      await db.collection('puzzle_answers').doc(answer_doc_id).update({
        data: {
          streak_days,
          streak_bonus_days: PUZZLE_STREAK_BONUS_DAYS,
          streak_bonus_points,
          total_score_gained,
          updated_at: db.serverDate()
        }
      });
    } catch (error) {
      console.warn('[puzzle] update streak meta failed:', error && error.message);
    }

    return success({
      answer_id: answer_doc_id,
      is_correct,
      correct_answer,
      answer_explanation: puzzle.answer_explanation || '',
      score_gained,
      streak_days,
      current_streak: streak_days,
      streak_bonus_points,
      total_score_gained,
      streak_bonus_days: PUZZLE_STREAK_BONUS_DAYS,
      next_streak_bonus_in: calcNextStreakBonusIn(streak_days)
    }, is_correct ? '答对了！' : '答错了，再接再厉');
  } catch (error) {
    return fail('提交答案失败: ' + error.message);
  }
}

async function puzzle_getPuzzleHistory(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const page = numberValue(event.page, 1);
    const page_size = numberValue(event.page_size, 10);

    if (!user) return fail('请先完成授权登录');

    const res = await db.collection('puzzle_answers')
      .where({ user_id: user._id })
      .orderBy('created_at', 'desc')
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();

    return success({
      list: res.data.map(normalizeAnswerRecord),
      page,
      page_size
    }, '获取成功');
  } catch (error) {
    return fail('获取历史失败: ' + error.message);
  }
}

async function puzzle_getPuzzleDetail(event) {
  try {
    const puzzle_id = event.puzzle_id;
    if (!puzzle_id) return fail('缺少谜题编号');

    const res = await db.collection('puzzles').doc(puzzle_id).get();
    const options = await getPuzzleOptions(res.data);
    return success(normalizePuzzle(res.data, options, null), '获取成功');
  } catch (error) {
    return fail('获取详情失败: ' + error.message);
  }
}

async function puzzle_subscribeDailyReminder() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const subscription_id = `puzzle_sub_${user._id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
    const data = {
      subscription_id,
      user_id: user._id,
      openid: wx_context.OPENID,
      active: true,
      updated_at: db.serverDate()
    };

    try {
      await db.collection('puzzle_subscriptions').add({
        data: {
          _id: subscription_id,
          ...data,
          last_reminded_date: '',
          created_at: db.serverDate()
        }
      });
    } catch (error) {
      if (isCollectionMissing(error)) throw error;
      await db.collection('puzzle_subscriptions').doc(subscription_id).update({ data });
    }

    return success({ subscription_id }, '每日谜题提醒已订阅');
  } catch (error) {
    return fail('订阅提醒登记失败: ' + error.message);
  }
}

async function runDailyPuzzleReminder() {
  const current_date = todayText();
  const summary = {
    date: current_date,
    sent: 0,
    failed: 0,
    skipped_no_template: !PUZZLE_DAILY_REMINDER_TMPL,
    skipped_no_puzzle: false
  };

  if (!PUZZLE_DAILY_REMINDER_TMPL) return success(summary, '谜题提醒模板未配置');

  const puzzle = await getPuzzleByDate(current_date);
  if (!puzzle || puzzle.status !== 'published') {
    summary.skipped_no_puzzle = true;
    return success(summary, '今日谜题未发布');
  }

  let subscribers = [];
  try {
    const res = await db.collection('puzzle_subscriptions')
      .where({
        active: true,
        last_reminded_date: _.neq(current_date)
      })
      .limit(PUZZLE_REMINDER_MAX_PER_RUN)
      .get();
    subscribers = res.data || [];
  } catch (error) {
    if (isCollectionMissing(error)) return success(summary, '暂无订阅用户');
    throw error;
  }

  for (const item of subscribers) {
    const sent = await sendSubscribeMessage(item.openid, PUZZLE_DAILY_REMINDER_TMPL, {
      thing1: { value: asThing(puzzle.title || puzzle.content || '每日谜题', 20) },
      date2: { value: current_date },
      thing3: { value: asThing(puzzle.difficulty || '中等', 20) },
      thing4: { value: asThing('今日谜题已发布，快来挑战', 20) }
    }, 'pages/puzzle/index');

    if (sent) {
      summary.sent += 1;
      try {
        await db.collection('puzzle_subscriptions').doc(item._id).update({
          data: {
            last_reminded_date: current_date,
            last_reminded_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
      } catch (error) {
        console.warn('[puzzle reminder] mark sent failed:', error && error.message);
      }
    } else {
      summary.failed += 1;
    }
  }

  return success(summary, '每日谜题提醒任务完成');
}

async function puzzle_getStats() {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const res = await db.collection('puzzle_answers')
      .where({ user_id: user._id })
      .orderBy('answered_at', 'desc')
      .limit(100)
      .get();
    const list = res.data || [];
    const correct_count = list.filter(item => item.is_correct).length;
    const streak_stats = await getPuzzleStreakStats(user);

    return success({
      total_answered: list.length,
      correct_count,
      correct_rate: list.length > 0 ? Math.round((correct_count / list.length) * 100) : 0,
      current_streak: streak_stats.current_streak,
      streak_bonus_days: PUZZLE_STREAK_BONUS_DAYS,
      streak_bonus_points: PUZZLE_STREAK_BONUS_POINTS,
      next_streak_bonus_in: streak_stats.next_streak_bonus_in
    }, '获取成功');
  } catch (error) {
    return fail('获取答题统计失败: ' + error.message);
  }
}

// ========== 谜题库 Actions ==========

async function puzzle_getPuzzleBank(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    const page = Math.max(1, numberValue(event.page, 1));
    const page_size = Math.min(50, Math.max(1, numberValue(event.page_size, 12)));
    const { category, difficulty, sort_by, sort_order, keyword } = event;

    // 构建查询条件 — 谜题库自有谜题 + 往期每日谜题 + 无类型旧数据
    const today = todayText();
    const conditions = [
      { status: 'published' },
      _.or([
        { puzzle_type: 'bank' },
        _.and([{ puzzle_type: 'daily' }, { publish_date: _.lt(today) }]),
        { puzzle_type: _.exists(false) }
      ])
    ];
    if (category) conditions.push({ category });
    if (difficulty) conditions.push({ difficulty });

    // 关键词搜索
    if (keyword) {
      const kw = String(keyword).trim();
      if (kw) {
        conditions.push({ content: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) });
      }
    }

    const where = _.and(conditions);

    // 排序
    let order_field = 'publish_date';
    let order_dir = 'desc';
    if (sort_by === 'difficulty') {
      // 使用 difficulty_order 数值字段排序: easy=1, normal/medium=2, hard=3, extreme=4
      order_field = 'difficulty_order';
      order_dir = sort_order === 'desc' ? 'desc' : 'asc';
    } else if (sort_by === 'correct_rate') {
      order_field = 'correct_count';
      order_dir = sort_order === 'desc' ? 'desc' : 'asc';
    } else if (sort_by === 'date') {
      order_field = 'publish_date';
      order_dir = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      order_dir = sort_order === 'asc' ? 'asc' : 'desc';
    }

    // 查询总数
    let total = 0;
    try {
      const count_res = await db.collection('puzzles').where(where).count();
      total = count_res.total || 0;
    } catch (_) { /* ignore */ }

    const res = await db.collection('puzzles')
      .where(where)
      .orderBy(order_field, order_dir)
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();

    // 获取当前用户的收藏列表
    const favorite_set = new Set();
    if (user) {
      try {
        const fav_res = await db.collection('puzzle_favorites')
          .where({ user_id: user._id })
          .field({ puzzle_id: true })
          .get();
        (fav_res.data || []).forEach(item => favorite_set.add(item.puzzle_id));
      } catch (error) {
        if (!isCollectionMissing(error)) console.warn('[puzzle bank] load favorites failed:', error.message);
      }
    }

    const list = (res.data || []).map(puzzle => {
      const attempt = numberValue(puzzle.attempt_count, 0);
      const correct = numberValue(puzzle.correct_count, 0);
      const correct_rate = attempt > 0 ? Math.round((correct / attempt) * 100) : 0;
      const DIFFICULTY_MAP = { easy: '简单', normal: '中等', medium: '中等', hard: '困难', extreme: '极限' };
      const raw = String(puzzle.difficulty || '').toLowerCase();

      return {
        puzzle_id: puzzle._id || puzzle.puzzle_id || '',
        title: puzzle.title || '',
        content: (puzzle.content || '').slice(0, 80),
        difficulty: puzzle.difficulty || 'normal',
        _difficulty_class: /^(easy|normal|medium|hard|extreme)$/.test(raw) ? raw : 'normal',
        _difficulty_text: DIFFICULTY_MAP[raw] || (puzzle.difficulty || '中等'),
        category: puzzle.category || '未分类',
        tags: puzzle.tags || [],
        attempt_count: attempt,
        correct_count: correct,
        correct_rate,
        reward_points: numberValue(puzzle.reward_points, 10),
        publish_date: puzzle.publish_date || '',
        is_favorited: favorite_set.has(puzzle._id || puzzle.puzzle_id || '')
      };
    });

    return success({
      list,
      total,
      page,
      page_size,
      has_more: page * page_size < total
    }, '获取成功');
  } catch (error) {
    return fail('获取谜题库失败: ' + error.message);
  }
}

async function puzzle_getPuzzleCategories() {
  try {
    const res = await db.collection('puzzles')
      .where({ status: 'published' })
      .field({ category: true })
      .limit(500)
      .get();

    const count_map = {};
    (res.data || []).forEach(puzzle => {
      const cat = puzzle.category || '未分类';
      count_map[cat] = (count_map[cat] || 0) + 1;
    });

    const CATEGORY_ORDER = ['逻辑推理', '密码解密', '字谜', '数学', '观察力', '其他'];
    const categories = CATEGORY_ORDER.map(cat => ({
      value: cat,
      label: cat,
      count: count_map[cat] || 0
    }));

    // 追加任何未在预定义列表中的分类
    Object.keys(count_map).forEach(cat => {
      if (!CATEGORY_ORDER.includes(cat)) {
        categories.push({ value: cat, label: cat, count: count_map[cat] });
      }
    });

    return success(categories, '获取成功');
  } catch (error) {
    return fail('获取分类失败: ' + error.message);
  }
}

async function puzzle_toggleFavorite(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const puzzle_id = event.puzzle_id;
    if (!puzzle_id) return fail('缺少谜题编号');

    // 检查是否已收藏
    const existing = await db.collection('puzzle_favorites')
      .where({ user_id: user._id, puzzle_id })
      .limit(1)
      .get();

    if (existing.data.length > 0) {
      // 取消收藏
      await db.collection('puzzle_favorites').doc(existing.data[0]._id).remove();
      return success({ is_favorited: false }, '已取消收藏');
    } else {
      // 添加收藏
      await db.collection('puzzle_favorites').add({
        data: {
          user_id: user._id,
          puzzle_id,
          created_at: db.serverDate()
        }
      });
      return success({ is_favorited: true }, '已收藏');
    }
  } catch (error) {
    if (isCollectionMissing(error)) return fail('收藏功能暂不可用，请稍后重试');
    return fail('操作收藏失败: ' + error.message);
  }
}

async function puzzle_getFavorites(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const page = Math.max(1, numberValue(event.page, 1));
    const page_size = Math.min(50, Math.max(1, numberValue(event.page_size, 12)));

    const fav_res = await db.collection('puzzle_favorites')
      .where({ user_id: user._id })
      .orderBy('created_at', 'desc')
      .skip((page - 1) * page_size)
      .limit(page_size)
      .get();

    let total = 0;
    try {
      const count_res = await db.collection('puzzle_favorites')
        .where({ user_id: user._id })
        .count();
      total = count_res.total || 0;
    } catch (_) { /* ignore */ }

    // 获取对应谜题详情（分批查询，避免 _.in() 超过100项限制）
    const puzzle_ids = (fav_res.data || []).map(item => item.puzzle_id);
    const list = [];
    if (puzzle_ids.length > 0) {
      const puzzle_map = {};
      // 微信云开发 _.in() 限制约100项，分批查询
      const IN_BATCH = 80;
      for (let i = 0; i < puzzle_ids.length; i += IN_BATCH) {
        const batch_ids = puzzle_ids.slice(i, i + IN_BATCH);
        const puzzles_res = await db.collection('puzzles')
          .where({ _id: _.in(batch_ids) })
          .get();
        (puzzles_res.data || []).forEach(p => { puzzle_map[p._id] = p; });
      }

      const DIFFICULTY_MAP = { easy: '简单', normal: '中等', medium: '中等', hard: '困难', extreme: '极限' };

      (fav_res.data || []).forEach(fav => {
        const puzzle = puzzle_map[fav.puzzle_id];
        if (!puzzle) return;
        const attempt = numberValue(puzzle.attempt_count, 0);
        const correct = numberValue(puzzle.correct_count, 0);
        const raw = String(puzzle.difficulty || '').toLowerCase();

        list.push({
          puzzle_id: puzzle._id || puzzle.puzzle_id || '',
          title: puzzle.title || '',
          content: (puzzle.content || '').slice(0, 80),
          difficulty: puzzle.difficulty || 'normal',
          _difficulty_class: /^(easy|normal|medium|hard|extreme)$/.test(raw) ? raw : 'normal',
          _difficulty_text: DIFFICULTY_MAP[raw] || (puzzle.difficulty || '中等'),
          category: puzzle.category || '未分类',
          tags: puzzle.tags || [],
          attempt_count: attempt,
          correct_count: correct,
          correct_rate: attempt > 0 ? Math.round((correct / attempt) * 100) : 0,
          reward_points: numberValue(puzzle.reward_points, 10),
          publish_date: puzzle.publish_date || '',
          is_favorited: true,
          favorited_at: fav.created_at
        });
      });
    }

    return success({
      list,
      total,
      page,
      page_size,
      has_more: page * page_size < total
    }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return success({ list: [], total: 0, page: 1, page_size: 12, has_more: false });
    return fail('获取收藏失败: ' + error.message);
  }
}

async function puzzle_getFavoriteIds(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const fav_res = await db.collection('puzzle_favorites')
      .where({ user_id: user._id })
      .field({ puzzle_id: true })
      .get();

    const ids = (fav_res.data || []).map(item => item.puzzle_id);
    return success({ ids }, '获取成功');
  } catch (error) {
    if (isCollectionMissing(error)) return success({ ids: [] });
    return fail('获取收藏ID失败: ' + error.message);
  }
}

async function puzzle_submitPracticeAnswer(event) {
  try {
    const wx_context = cloud.getWXContext();
    const user = await getCurrentUser(wx_context.OPENID);
    if (!user) return fail('请先完成授权登录');

    const puzzle_id = event.puzzle_id;
    const selected_value = event.answer || event.option_id;
    if (!puzzle_id) return fail('缺少谜题编号');
    if (!selected_value) return fail('请选择答案');

    // 幂等防重：使用稳定 _id 防止并发重复提交
    const stable_id = `ppa_${user._id}_${puzzle_id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);

    // 先检查已有记录（幂等读取）
    const existing = await db.collection('puzzle_practice_answers')
      .where({ user_id: user._id, puzzle_id })
      .limit(1)
      .get();
    if (existing.data.length > 0) {
      const record = existing.data[0];
      return success({
        answer_id: record._id,
        is_correct: !!record.is_correct,
        correct_answer: '',
        answer_explanation: '',
        already_answered: true
      }, '您已经练习过这道谜题了');
    }

    // 获取谜题和选项
    const puzzle_res = await db.collection('puzzles').doc(puzzle_id).get();
    const puzzle = puzzle_res.data;
    if (!puzzle) return fail('谜题不存在');

    const options = await getPuzzleOptions(puzzle);
    const selected_option = options.find(item => (
      item.option_id === selected_value ||
      item.option_label === selected_value ||
      item.option_content === selected_value
    ));
    const selected_answer = selected_option ? selected_option.option_content : selected_value;
    const correct_option = options.find(item => item.is_correct);
    const correct_answer = correct_option ? correct_option.option_content : '';
    const is_correct = !!correct_answer && selected_answer === correct_answer;

    // 使用稳定 _id 写入：并发第二次会因 _id 冲突失败 → 防止重复计数
    try {
      await db.collection('puzzle_practice_answers').add({
        data: {
          _id: stable_id,
          user_id: user._id,
          puzzle_id,
          selected_option_id: selected_option ? selected_option.option_id : '',
          is_correct,
          answered_at: db.serverDate()
        }
      });
    } catch (error) {
      // _id 冲突：说明已被并发写入，幂等返回
      const dup = await db.collection('puzzle_practice_answers').doc(stable_id).get().catch(() => null);
      if (dup && dup.data) {
        return success({
          answer_id: dup.data._id,
          is_correct: !!dup.data.is_correct,
          correct_answer,
          answer_explanation: puzzle.answer_explanation || '',
          already_answered: true,
          idempotent: true
        }, '您已经练习过这道谜题了');
      }
      throw error;
    }

    // 原子更新谜题统计（不计分）
    try {
      await db.collection('puzzles').doc(puzzle_id).update({
        data: {
          attempt_count: _.inc(1),
          correct_count: is_correct ? _.inc(1) : _.inc(0)
        }
      });
    } catch (error) {
      console.warn('[practice] update puzzle stats failed:', error.message);
    }

    return success({
      is_correct,
      correct_answer,
      answer_explanation: puzzle.answer_explanation || ''
    }, is_correct ? '答对了！' : '答错了，再接再厉');
  } catch (error) {
    if (isCollectionMissing(error)) return fail('练习功能暂不可用，请稍后重试');
    return fail('提交练习答案失败: ' + error.message);
  }
}

// ========== 导出 ==========

exports.main = async (event, context) => {
  if (event && event.Type === 'timer') {
    return runDailyPuzzleReminder();
  }

  const { action = 'getTodayPuzzle', ...data } = event || {};
  const actions = {
    getTodayPuzzle: puzzle_getTodayPuzzle,
    submitAnswer: puzzle_submitAnswer,
    getPuzzleHistory: puzzle_getPuzzleHistory,
    getPuzzleDetail: puzzle_getPuzzleDetail,
    getStats: puzzle_getStats,
    subscribeDailyReminder: puzzle_subscribeDailyReminder,
    runDailyReminder: runDailyPuzzleReminder,
    // 谜题库
    getPuzzleBank: puzzle_getPuzzleBank,
    getPuzzleCategories: puzzle_getPuzzleCategories,
    toggleFavorite: puzzle_toggleFavorite,
    getFavorites: puzzle_getFavorites,
    getFavoriteIds: puzzle_getFavoriteIds,
    submitPracticeAnswer: puzzle_submitPracticeAnswer
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);

  return handler(data, context);
};
