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

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeRecommendation(item = {}, source = 'recommendations') {
  const recommendation_id = item.recommendation_id || item._id || '';
  const title = item.title || '';
  const category = item.category || 'general';
  const article_url = item.article_url || item.link_url || '';
  const published_at = item.published_at || item.created_at || '';

  return {
    recommendation_id,
    title,
    category,
    recommender_id: item.recommender_id || '',
    recommender_name: item.recommender_name || 'NK推协',
    reason: item.reason || item.description || item.summary || '',
    article_url,
    link_url: item.link_url || article_url,
    cover_url: item.cover_url || '',
    source,
    status: item.status || 'published',
    published_at,
    created_at: item.created_at || published_at,
    updated_at: item.updated_at || item.created_at || published_at
  };
}

function matchKeyword(item, keyword) {
  if (!keyword) return true;
  const haystack = [
    item.title,
    item.category,
    item.recommender_name,
    item.reason
  ].join(' ').toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

async function queryRecommendations({ category, keyword, page, page_size }) {
  try {
    const where = { status: _.neq('hidden') };
    if (category && category !== 'all') where.category = category;

    const res = await db.collection('recommendations')
      .where(where)
      .orderBy('published_at', 'desc')
      .limit(100)
      .get();
    const filtered = (res.data || [])
      .map(item => normalizeRecommendation(item))
      .filter(item => item.status !== 'offline')
      .filter(item => matchKeyword(item, keyword));
    const start = (page - 1) * page_size;

    return {
      list: filtered.slice(start, start + page_size),
      total: filtered.length
    };
  } catch (error) {
    if (isCollectionMissing(error)) return { list: [], total: 0 };
    throw error;
  }
}

async function queryActivityFallback({ category, keyword, page, page_size }) {
  if (category && !['all', 'activity'].includes(category)) return { list: [], total: 0 };

  try {
    const res = await db.collection('activities')
      .orderBy('created_at', 'desc')
      .limit(50)
      .get();
    const list = (res.data || [])
      .map(item => normalizeRecommendation({
        ...item,
        recommendation_id: item._id,
        category: 'activity',
        recommender_name: 'NK推协',
        reason: item.description || '近期社团活动推荐',
        published_at: item.created_at
      }, 'activities'))
      .filter(item => !['hidden', 'offline'].includes(item.status))
      .filter(item => matchKeyword(item, keyword));
    const start = (page - 1) * page_size;

    return {
      list: list.slice(start, start + page_size),
      total: list.length
    };
  } catch (error) {
    if (isCollectionMissing(error)) return { list: [], total: 0 };
    throw error;
  }
}

async function recommendation_getRecommendations(event) {
  try {
    const page = Math.max(Number(event.page) || 1, 1);
    const page_size = Math.min(Math.max(Number(event.page_size || event.limit) || 10, 1), 30);
    const category = cleanText(event.category || 'all') || 'all';
    const keyword = cleanText(event.keyword);

    let result = await queryRecommendations({ category, keyword, page, page_size });
    if (result.list.length === 0 && page === 1 && !keyword) {
      result = await queryActivityFallback({ category, keyword, page, page_size });
    }

    return ok({
      list: result.list,
      total: result.total,
      page,
      page_size,
      has_more: page * page_size < result.total
    }, '获取成功');
  } catch (error) {
    return fail(`获取推荐失败: ${error.message}`);
  }
}

async function recommendation_getDetail(event) {
  try {
    const recommendation_id = cleanText(event.recommendation_id);
    if (!recommendation_id) return fail('推荐编号不能为空');

    try {
      const res = await db.collection('recommendations').doc(recommendation_id).get();
      const item = normalizeRecommendation(res.data || {});
      if (['hidden', 'offline'].includes(item.status)) return fail('推荐内容不存在');
      return ok(item, '获取成功');
    } catch (error) {
      if (!isCollectionMissing(error) && error.errCode !== -1) throw error;
    }

    const fallback = await db.collection('activities').doc(recommendation_id).get();
    return ok(normalizeRecommendation({
      ...fallback.data,
      recommendation_id,
      category: 'activity',
      recommender_name: 'NK推协',
      reason: fallback.data.description,
      published_at: fallback.data.created_at
    }, 'activities'), '获取成功');
  } catch (error) {
    return fail(`获取详情失败: ${error.message}`);
  }
}

exports.main = async (event, context) => {
  const { action = 'getRecommendations', ...data } = event || {};
  const actions = {
    getRecommendations: recommendation_getRecommendations,
    getDetail: recommendation_getDetail,
    getRecommendationDetail: recommendation_getDetail
  };

  const handler = actions[action];
  if (!handler) return fail(`未知操作：${action}`);
  return handler(data, context);
};
