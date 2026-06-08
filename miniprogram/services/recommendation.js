const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class RecommendationService {
  async getRecommendations(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.recommendation.getRecommendations, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        category: options.category || '',
        keyword: options.keyword || ''
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取推荐列表失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error('Failed to get recommendations:', error);
      return { success: false, data: [], error: error.message || '获取推荐列表失败' };
    }
  }

  async getDetail(recommendation_id) {
    if (!recommendation_id) return { success: false, error: '内容编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.recommendation.getDetail, { recommendation_id });
      if (!result.success) return { success: false, error: result.message || '获取详情失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get recommendation detail:', error);
      return { success: false, error: error.message || '获取详情失败' };
    }
  }
}

module.exports = new RecommendationService();
