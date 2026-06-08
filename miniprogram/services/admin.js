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
}

module.exports = new AdminService();
