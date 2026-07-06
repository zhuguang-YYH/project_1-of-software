const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');
const { storage } = require('../utils/storage.js');

class RankingService {
  async getTopThree(options = {}) {
    try {
      const cached = (!options.period || options.period === 'all') && storage.getRankingCache && storage.getRankingCache();
      if (cached && cached.top_three) {
        return { success: true, data: cached.top_three, from_cache: true };
      }

      const result = await callFunction(
        CONFIG.api.ranking.getTopThree,
        { period: options.period || 'all' },
        { timeout: CONFIG.timeout.ranking }
      );

      if (result.success) {
        const next_cache = cached || {};
        next_cache.top_three = result.data || [];
        if (storage.setRankingCache) storage.setRankingCache(next_cache);
        return { success: true, data: result.data || [] };
      }
    } catch (error) {
      console.error('Failed to get top three:', error);
    }

    return { success: false, data: [], error: 'Load top three failed' };
  }

  async getFullRanking(options = {}) {
    const page = options.page || 1;
    const page_size = options.page_size || CONFIG.pagination.pageSize;

    if (page > CONFIG.pagination.maxPages) {
      return { success: false, error: 'Page out of range' };
    }

    try {
      const result = await callFunction(
        CONFIG.api.ranking.getFullRanking,
        { page, page_size, period: options.period || 'all' },
        { timeout: CONFIG.timeout.ranking }
      );

      if (result.success) {
        const total = result.total || (result.data && result.data.total) || 0;
        return {
          success: true,
          data: (result.data && result.data.list) || result.data || [],
          total,
          page,
          page_size,
          pages: Math.ceil(total / page_size)
        };
      }
    } catch (error) {
      console.error('Failed to get full ranking:', error);
    }

    return { success: false, data: [], error: 'Load ranking failed' };
  }

  async getUserRanking(options = {}) {
    try {
      const result = await callFunction(
        CONFIG.api.ranking.getUserRanking,
        { period: options.period || 'all' },
        { timeout: CONFIG.timeout.ranking }
      );

      if (result.success) {
        return {
          success: true,
          data: result.data || null
        };
      }
    } catch (error) {
      console.error('Failed to get user ranking:', error);
    }

    return { success: false, data: null, error: 'Load user ranking failed' };
  }

  async getRankingStats() {
    try {
      const result = await callFunction('ranking_getStats');
      if (result.success) return { success: true, data: result.data || {} };
    } catch (error) {
      console.error('Failed to get ranking stats:', error);
    }

    return { success: false, data: {} };
  }

  refreshCache() {
    storage.removeSync('ranking_cache');
  }
}

module.exports = new RankingService();
