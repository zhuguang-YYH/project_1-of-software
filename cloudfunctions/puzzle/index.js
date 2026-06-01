const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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
    answered_at: item.answered_at || item.created_at || '',
    created_at: item.created_at || ''
  };
}

function normalizePuzzle(puzzle, options, answer_record) {
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
    correct_answer: answer_record && correct_option ? correct_option.option_content : ''
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
  const data = {
    user_id: user._id,
    ...points,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const add_res = await db.collection('point_accounts').add({ data });
  return { _id: add_res._id, ...data };
}

async function addPuzzlePoints(user, points, puzzle_id) {
  await ensurePointAccount(user);
  // 原子加分：直接使用 _.inc，避免"先读后写"竞态
  await db.collection('users').doc(user._id).update({
    data: {
      total_points: db.command.inc(points),
      available_points: db.command.inc(points),
      updated_at: db.serverDate()
    }
  });
  await db.collection('point_accounts').where({ user_id: user._id }).update({
    data: {
      total_points: db.command.inc(points),
      available_points: db.command.inc(points),
      updated_at: db.serverDate()
    }
  });
  await db.collection('points_log').add({
    data: {
      user_id: user._id,
      amount: points,
      change_amount: points,
      point_type: 'available',
      type: 'income',
      business_type: 'daily_puzzle',
      related_id: puzzle_id,
      reason: '每日谜题答对奖励',
      description: '每日谜题答对奖励',
      created_at: db.serverDate()
    }
  });
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
  const res = await db.collection('puzzles')
    .where({ publish_date, status: 'published' })
    .limit(1)
    .get();

  if (res.data.length > 0) return res.data[0];

  const fallback = await db.collection('puzzles')
    .where({ publish_date })
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

    return success(normalizePuzzle(puzzle, options, answer_record), '获取成功');
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
      return success({
        answer_id: existing._id,
        is_correct: !!existing.is_correct,
        correct_answer: '',
        answer_explanation: '',
        score_gained: numberValue(existing.score_gained, 0),
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
        return success({
          answer_id: dup._id,
          is_correct: !!dup.is_correct,
          correct_answer,
          answer_explanation: puzzle.answer_explanation || '',
          score_gained: numberValue(dup.score_gained, 0),
          idempotent: true
        }, '您今天已经答过这道谜题了');
      }
      throw error;
    }

    if (score_gained > 0) {
      await addPuzzlePoints(user, score_gained, puzzle_id);
    }

    return success({
      answer_id: answer_doc_id,
      is_correct,
      correct_answer,
      answer_explanation: puzzle.answer_explanation || '',
      score_gained
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

function calcCurrentStreak(list) {
  let streak = 0;
  for (const item of list) {
    if (!item.is_correct) break;
    streak += 1;
  }
  return streak;
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

    return success({
      total_answered: list.length,
      correct_count,
      correct_rate: list.length > 0 ? Math.round((correct_count / list.length) * 100) : 0,
      current_streak: calcCurrentStreak(list)
    }, '获取成功');
  } catch (error) {
    return fail('获取答题统计失败: ' + error.message);
  }
}

exports.main = async (event, context) => {
  const { action = 'getTodayPuzzle', ...data } = event || {};
  const actions = {
    getTodayPuzzle: puzzle_getTodayPuzzle,
    submitAnswer: puzzle_submitAnswer,
    getPuzzleHistory: puzzle_getPuzzleHistory,
    getPuzzleDetail: puzzle_getPuzzleDetail,
    getStats: puzzle_getStats
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);

  return handler(data, context);
};
