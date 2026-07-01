const { callFunction } = require('../utils/request.js');

function toListResult(result, fallbackMessage) {
  if (!result.success) return { success: false, data: [], error: result.message || fallbackMessage };
  return {
    success: true,
    data: (result.data && result.data.list) || [],
    total: (result.data && result.data.total) || 0,
    has_more: !!(result.data && result.data.has_more)
  };
}

class AdminService {
  call(action, data = {}, options = {}) {
    return callFunction(`admin_${action}`, data, options);
  }

  async getDashboard() {
    try {
      const result = await this.call('getDashboard');
      if (!result.success) return { success: false, data: {}, error: result.message || '获取后台概览失败' };
      return { success: true, data: result.data || {} };
    } catch (error) {
      console.error('Failed to get dashboard:', error);
      return { success: false, data: {}, error: error.message || '获取后台概览失败' };
    }
  }

  async savePuzzle(data) {
    return this.mutate('savePuzzle', data, '保存谜题失败');
  }

  async createActivity(data) {
    return this.mutate('createActivity', data, '创建活动失败');
  }

  async getActivityRegistrations(options = {}) {
    return this.listWithExtra('getActivityRegistrations', options, '获取活动报名失败');
  }

  async confirmActivityAttendance(data) {
    return this.mutate('confirmActivityAttendance', data, '确认参与失败');
  }

  async createBorrowItem(data) {
    return this.mutate('createBorrowItem', data, '创建物资失败');
  }

  async createExchangeGood(data) {
    return this.mutate('createExchangeGood', data, '创建兑换商品失败');
  }

  async createDudKeyword(data) {
    return this.mutate('createDudKeyword', data, '创建 Dud 关键词失败');
  }

  async createRecommendation(data) {
    return this.mutate('createRecommendation', data, '创建推荐内容失败');
  }

  async updateRecommendationStatus(data) {
    return this.mutate('updateRecommendationStatus', data, '更新推荐状态失败');
  }

  async updateBorrowStatus(data) {
    return this.mutate('updateBorrowStatus', data, '更新借阅状态失败');
  }

  async updateExchangeStatus(data) {
    return this.mutate('updateExchangeStatus', data, '更新兑换状态失败');
  }

  async updateExchangeGoodStatus(data) {
    return this.mutate('updateExchangeGoodStatus', data, '更新商品状态失败');
  }

  async updateFeedback(data) {
    return this.mutate('updateFeedback', data, '更新反馈状态失败');
  }

  async saveSystemSettings(data) {
    return this.mutate('saveSystemSettings', data, '保存系统设置失败');
  }

  async getBorrowApplications(options = {}) {
    return this.list('getBorrowApplications', options, '获取借阅申请失败');
  }

  async getExchangeRecords(options = {}) {
    return this.list('getExchangeRecords', options, '获取兑换记录失败');
  }

  async getExchangeGoods(options = {}) {
    return this.list('getExchangeGoods', options, '获取兑换商品失败');
  }

  async getFeedback(options = {}) {
    return this.list('getFeedback', options, '获取反馈列表失败');
  }

  async getLogs(options = {}) {
    return this.list('getLogs', options, '获取管理日志失败');
  }

  async getSystemSettings() {
    try {
      const result = await this.call('getSystemSettings');
      if (!result.success) return { success: false, data: {}, error: result.message || '获取系统设置失败' };
      return { success: true, data: result.data || {} };
    } catch (error) {
      console.error('Failed to get system settings:', error);
      return { success: false, data: {}, error: error.message || '获取系统设置失败' };
    }
  }

  async list(action, options, fallbackMessage) {
    try {
      const result = await this.call(action, options);
      return toListResult(result, fallbackMessage);
    } catch (error) {
      console.error(`Failed to call admin_${action}:`, error);
      return { success: false, data: [], error: error.message || fallbackMessage };
    }
  }

  async listWithExtra(action, options, fallbackMessage) {
    try {
      const result = await this.call(action, options);
      if (!result.success) return { success: false, data: [], error: result.message || fallbackMessage };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        waitlist: (result.data && result.data.waitlist) || [],
        total: (result.data && result.data.total) || 0,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error(`Failed to call admin_${action}:`, error);
      return { success: false, data: [], waitlist: [], error: error.message || fallbackMessage };
    }
  }

  async mutate(action, data, fallbackMessage) {
    try {
      const result = await this.call(action, data, { idempotent: true });
      if (!result.success) return { success: false, error: result.message || fallbackMessage };
      return { success: true, data: result.data || null, message: result.message || '操作成功' };
    } catch (error) {
      console.error(`Failed to call admin_${action}:`, error);
      return { success: false, error: error.message || fallbackMessage };
    }
  }

  // ========== 谜题库管理 ==========

  async setFeaturedPuzzle(puzzle_id, date) {
    return this.mutate('setFeaturedPuzzle', { puzzle_id, date }, '设置推荐谜题失败');
  }

  async updatePuzzleBank(puzzle_id, data) {
    return this.mutate('updatePuzzleBank', { puzzle_id, ...data }, '更新谜题失败');
  }

  // ========== 交友管理 ==========

  async getDatingStats() {
    try {
      const result = await this.call('getDatingStats');
      if (!result.success) return { success: false, data: {}, error: result.message || '获取交友统计失败' };
      return { success: true, data: result.data || {} };
    } catch (error) {
      console.error('Failed to get dating stats:', error);
      return { success: false, data: {}, error: error.message || '获取交友统计失败' };
    }
  }

  async getDatingPool(options = {}) {
    return this.list('getDatingPool', options, '获取交友池失败');
  }

  async getDatingMatches(options = {}) {
    return this.list('getDatingMatches', options, '获取匹配记录失败');
  }

  async removeFromPool(user_id) {
    return this.mutate('removeFromPool', { user_id }, '移除失败');
  }

  async deactivateMatch(match_id) {
    return this.mutate('deactivateMatch', { match_id }, '解除匹配失败');
  }

  // ========== 删除操作 ==========
  async deletePuzzle(puzzle_id) {
    return this.mutate('deletePuzzle', { puzzle_id }, '删除谜题失败');
  }

  async deleteActivity(activity_id) {
    return this.mutate('deleteActivity', { activity_id }, '删除活动失败');
  }

  async deleteExchangeGood(item_id) {
    return this.mutate('deleteExchangeGood', { item_id }, '删除商品失败');
  }

  async deleteRecommendation(recommendation_id) {
    return this.mutate('deleteRecommendation', { recommendation_id }, '删除推荐失败');
  }

  async deleteDudKeyword(keyword_id) {
    return this.mutate('deleteDudKeyword', { keyword_id }, '删除关键词失败');
  }
}

module.exports = new AdminService();
