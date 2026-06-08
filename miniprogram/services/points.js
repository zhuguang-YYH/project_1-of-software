const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

function zeroPoints() {
  return {
    success: false,
    total_points: 0,
    available_points: 0,
    frozen_points: 0,
    used_points: 0
  };
}

class PointsService {
  async getUserPoints() {
    try {
      const result = await callFunction('points_getUserPoints', {});
      if (!result.success) return zeroPoints();

      const data = result.data || {};
      return {
        success: true,
        total_points: Number(data.total_points || 0),
        available_points: Number(data.available_points || 0),
        frozen_points: Number(data.frozen_points || 0),
        used_points: Number(data.used_points || 0)
      };
    } catch (error) {
      console.error('Failed to get user points:', error);
      return zeroPoints();
    }
  }

  async getPointsHistory(options = {}) {
    try {
      const result = await callFunction('points_getHistory', {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        type: options.type || '',
        start_date: options.start_date || '',
        end_date: options.end_date || ''
      });

      if (!result.success) {
        return { success: false, data: [], error: result.message || '获取积分流水失败' };
      }

      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        page: result.data && result.data.page,
        page_size: result.data && result.data.page_size,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error('Failed to get points history:', error);
      return { success: false, data: [], error: error.message || '获取积分流水失败' };
    }
  }

  async addPoints(user_id, amount, reason) {
    if (!user_id || amount <= 0 || !reason) {
      return { success: false, error: '参数不合法' };
    }

    try {
      const result = await callFunction('points_addPoints', { user_id, amount, reason });
      if (!result.success) return { success: false, error: result.message || '添加积分失败' };
      return {
        success: true,
        available_points: result.data && result.data.available_points
      };
    } catch (error) {
      console.error('Failed to add points:', error);
      return { success: false, error: error.message || '添加积分失败' };
    }
  }

  async deductPoints(user_id, amount, reason) {
    if (!user_id || amount <= 0 || !reason) {
      return { success: false, error: '参数不合法' };
    }

    try {
      const result = await callFunction('points_deductPoints', { user_id, amount, reason });
      if (!result.success) return { success: false, error: result.message || '扣除积分失败' };
      return {
        success: true,
        available_points: result.data && result.data.available_points
      };
    } catch (error) {
      console.error('Failed to deduct points:', error);
      return { success: false, error: error.message || '扣除积分失败' };
    }
  }

  async freezePoints(amount) {
    if (amount <= 0) {
      return { success: false, error: '冻结积分必须大于 0' };
    }

    try {
      const result = await callFunction('points_freezePoints', { amount });
      if (!result.success) return { success: false, error: result.message || '冻结积分失败' };
      return {
        success: true,
        frozen_points: result.data && result.data.frozen_points
      };
    } catch (error) {
      console.error('Failed to freeze points:', error);
      return { success: false, error: error.message || '冻结积分失败' };
    }
  }

  async unfreezePoints(amount) {
    if (amount <= 0) {
      return { success: false, error: '解冻积分必须大于 0' };
    }

    try {
      const result = await callFunction('points_unfreezePoints', { amount });
      if (!result.success) return { success: false, error: result.message || '解冻积分失败' };
      return {
        success: true,
        frozen_points: result.data && result.data.frozen_points
      };
    } catch (error) {
      console.error('Failed to unfreeze points:', error);
      return { success: false, error: error.message || '解冻积分失败' };
    }
  }

  async hasEnoughPoints(required_points) {
    try {
      const points = await this.getUserPoints();
      return points.success && points.available_points >= required_points;
    } catch (error) {
      console.error('Failed to check points:', error);
      return false;
    }
  }

  async getPointsAnalysis() {
    try {
      const result = await callFunction('points_getAnalysis', {});
      if (!result.success) return { success: false, sources: [], distribution: {} };
      return {
        success: true,
        sources: (result.data && result.data.sources) || [],
        distribution: (result.data && result.data.distribution) || {}
      };
    } catch (error) {
      console.error('Failed to get points analysis:', error);
      return { success: false, sources: [], distribution: {} };
    }
  }
}

module.exports = new PointsService();
