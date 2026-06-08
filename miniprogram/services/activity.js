const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class ActivityService {
  async getActivities(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.activity.getActivities, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        status: options.status || '',
        campus: options.campus || '',
        keyword: options.keyword || ''
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取活动列表失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        page: result.data && result.data.page,
        page_size: result.data && result.data.page_size,
        has_more: result.data && result.data.has_more
      };
    } catch (error) {
      console.error('Failed to get activities:', error);
      return { success: false, data: [], error: error.message || '获取活动列表失败' };
    }
  }

  async getActivityDetail(activity_id) {
    if (!activity_id) return { success: false, error: '活动编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.activity.getActivityDetail, { activity_id });
      if (!result.success) return { success: false, error: result.message || '获取活动详情失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get activity detail:', error);
      return { success: false, error: error.message || '获取活动详情失败' };
    }
  }

  async registerActivity(activity_id, options = {}) {
    if (!activity_id) return { success: false, error: '活动编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.activity.register, {
        activity_id,
        reason: options.reason || '',
        can_not_cancel_confirm: !!options.can_not_cancel_confirm
      }, { idempotent: true });
      if (!result.success) {
        return {
          success: false,
          code: result.code,
          error: result.message || '报名失败'
        };
      }
      return {
        success: true,
        registration_id: result.data && result.data.registration_id
      };
    } catch (error) {
      console.error('Failed to register activity:', error);
      return { success: false, error: error.message || '报名失败' };
    }
  }

  async confirmRegister(activity_id, options = {}) {
    return this.registerActivity(activity_id, {
      ...options,
      can_not_cancel_confirm: true
    });
  }

  async cancelRegister(activity_id) {
    if (!activity_id) return { success: false, error: '活动编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.activity.cancelRegister, { activity_id });
      if (!result.success) {
        return {
          success: false,
          code: result.code,
          error: result.message || '取消报名失败'
        };
      }
      return { success: true, message: '已取消报名' };
    } catch (error) {
      console.error('Failed to cancel register:', error);
      return { success: false, error: error.message || '取消报名失败' };
    }
  }

  async getMyActivities(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.activity.getMyActivities, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        status: options.status || ''
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取我的活动失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        page: result.data && result.data.page,
        page_size: result.data && result.data.page_size,
        has_more: result.data && result.data.has_more
      };
    } catch (error) {
      console.error('Failed to get my activities:', error);
      return { success: false, data: [], error: error.message || '获取我的活动失败' };
    }
  }

  async canCancelRegistration(activity_id) {
    try {
      const detail = await this.getActivityDetail(activity_id);
      if (!detail.success) return { success: false, can_cancel: false };

      const deadline = new Date(detail.data.cancel_deadline);
      const can_cancel = Number.isNaN(deadline.getTime()) || new Date() < deadline;
      return {
        success: true,
        can_cancel,
        cancel_deadline: detail.data.cancel_deadline
      };
    } catch (error) {
      console.error('Failed to check cancel status:', error);
      return { success: false, can_cancel: false };
    }
  }

  async getActivityStats() {
    try {
      const result = await callFunction('activity_getStats', {});
      if (!result.success) return { success: false, data: {} };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get activity stats:', error);
      return { success: false, data: {} };
    }
  }
}

module.exports = new ActivityService();
