const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class PuzzleService {
  async getTodayPuzzle() {
    try {
      const result = await callFunction(CONFIG.api.puzzle.getTodayPuzzle, {});
      if (!result.success) {
        return { success: false, error: result.message || '获取今日谜题失败' };
      }
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get today puzzle:', error);
      return { success: false, error: error.message || '获取今日谜题失败' };
    }
  }

  async getPuzzleDetail(puzzle_id) {
    if (!puzzle_id) {
      return { success: false, error: '谜题编号不能为空' };
    }

    try {
      const result = await callFunction(CONFIG.api.puzzle.getPuzzleDetail, { puzzle_id });
      if (!result.success) {
        return { success: false, error: result.message || '获取谜题详情失败' };
      }
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get puzzle detail:', error);
      return { success: false, error: error.message || '获取谜题详情失败' };
    }
  }

  async submitAnswer(puzzle_id, option_id) {
    if (!puzzle_id || !option_id) {
      return { success: false, error: '答题参数不完整' };
    }

    try {
      const result = await callFunction(
        CONFIG.api.puzzle.submitAnswer,
        { puzzle_id, option_id },
        { idempotent: true }
      );

      if (!result.success) {
        return { success: false, error: result.message || '提交答案失败' };
      }

      const payload = result.data || {};
      return {
        success: true,
        data: payload,
        is_correct: !!payload.is_correct,
        score_gained: Number(payload.score_gained || 0),
        streak_days: Number(payload.streak_days || payload.current_streak || 0),
        streak_bonus_points: Number(payload.streak_bonus_points || 0),
        total_score_gained: Number(payload.total_score_gained || payload.score_gained || 0)
      };
    } catch (error) {
      console.error('Failed to submit answer:', error);
      return { success: false, error: error.message || '提交答案失败' };
    }
  }

  async getPuzzleHistory(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.puzzle.getPuzzleHistory, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize
      });

      if (!result.success) {
        return { success: false, error: result.message || '获取答题历史失败' };
      }

      return {
        success: true,
        data: (result.data && result.data.list) || [],
        page: result.data && result.data.page,
        page_size: result.data && result.data.page_size
      };
    } catch (error) {
      console.error('Failed to get puzzle history:', error);
      return { success: false, error: error.message || '获取答题历史失败' };
    }
  }

  async hasAnsweredToday() {
    const result = await this.getTodayPuzzle();
    return result.success && result.data && result.data.answered === true;
  }

  async getPuzzleStats() {
    try {
      const result = await callFunction('puzzle_getStats', {});
      if (!result.success) {
        return { success: false, error: result.message || '获取答题统计失败' };
      }

      const payload = result.data || {};
      return {
        success: true,
        data: payload,
        total_answered: Number(payload.total_answered || 0),
        correct_count: Number(payload.correct_count || 0),
        correct_rate: Number(payload.correct_rate || 0),
        current_streak: Number(payload.current_streak || 0),
        streak_bonus_days: Number(payload.streak_bonus_days || 0),
        streak_bonus_points: Number(payload.streak_bonus_points || 0),
        next_streak_bonus_in: Number(payload.next_streak_bonus_in || 0)
      };
    } catch (error) {
      console.error('Failed to get puzzle stats:', error);
      return {
        success: false,
        data: {
          total_answered: 0,
          correct_count: 0,
          correct_rate: 0,
          current_streak: 0
        }
      };
    }
  }

  async subscribeDailyReminder() {
    try {
      const result = await callFunction(CONFIG.api.puzzle.subscribeDailyReminder, {});
      if (!result.success) {
        return { success: false, error: result.message || '订阅提醒登记失败' };
      }
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to subscribe daily puzzle reminder:', error);
      return { success: false, error: error.message || '订阅提醒登记失败' };
    }
  }

  // ========== 谜题库 ==========

  async getPuzzleBank(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.puzzle.getPuzzleBank, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        category: options.category || '',
        difficulty: options.difficulty || '',
        sort_by: options.sort_by || 'date',
        sort_order: options.sort_order || 'desc',
        keyword: options.keyword || ''
      });
      if (!result.success) return { success: false, error: result.message || '获取谜题库失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get puzzle bank:', error);
      return { success: false, error: error.message || '获取谜题库失败' };
    }
  }

  async getPuzzleCategories() {
    try {
      const result = await callFunction(CONFIG.api.puzzle.getPuzzleCategories, {});
      if (!result.success) return { success: false, error: result.message || '获取分类失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get puzzle categories:', error);
      return { success: false, error: error.message || '获取分类失败' };
    }
  }

  async toggleFavorite(puzzle_id) {
    if (!puzzle_id) return { success: false, error: '谜题编号不能为空' };
    try {
      const result = await callFunction(CONFIG.api.puzzle.toggleFavorite, { puzzle_id }, { idempotent: true });
      if (!result.success) return { success: false, error: result.message || '操作收藏失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      return { success: false, error: error.message || '操作收藏失败' };
    }
  }

  async getFavorites(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.puzzle.getFavorites, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize
      });
      if (!result.success) return { success: false, error: result.message || '获取收藏失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get favorites:', error);
      return { success: false, error: error.message || '获取收藏失败' };
    }
  }

  async getFavoriteIds() {
    try {
      const result = await callFunction(CONFIG.api.puzzle.getFavoriteIds, {});
      if (!result.success) return { success: false, error: result.message || '获取收藏ID失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get favorite ids:', error);
      return { success: false, error: error.message || '获取收藏ID失败' };
    }
  }

  async submitPracticeAnswer(puzzle_id, option_id) {
    if (!puzzle_id || !option_id) return { success: false, error: '答题参数不完整' };
    try {
      const result = await callFunction(
        CONFIG.api.puzzle.submitPracticeAnswer,
        { puzzle_id, option_id },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '提交练习答案失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to submit practice answer:', error);
      return { success: false, error: error.message || '提交练习答案失败' };
    }
  }
}

module.exports = new PuzzleService();
