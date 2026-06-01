const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class CommissionService {
  async getCommissions(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.commission.getCommissions, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        status: options.status || ''
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取委托列表失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error('Failed to get commissions:', error);
      return { success: false, data: [], error: error.message || '获取委托列表失败' };
    }
  }

  async getMyCommissions() {
    try {
      const result = await callFunction(CONFIG.api.commission.getMyCommissions, {
        page: 1,
        page_size: 50
      });

      if (!result.success) return { success: false, data: { published: [], accepted: [] }, error: result.message || '获取我的委托失败' };
      const data = result.data || {};
      return {
        success: true,
        published: data.published || [],
        accepted: data.accepted || []
      };
    } catch (error) {
      console.error('Failed to get my commissions:', error);
      return { success: false, data: { published: [], accepted: [] }, error: error.message || '获取我的委托失败' };
    }
  }

  async publishCommission(params = {}) {
    const { title, content, reward_points, deadline } = params;
    if (!title || !title.trim()) return { success: false, error: '标题不能为空' };
    if (!content || !content.trim()) return { success: false, error: '内容不能为空' };
    if (!Number.isInteger(reward_points) || reward_points <= 0) return { success: false, error: '悬赏积分不合法' };

    try {
      const result = await callFunction(
        CONFIG.api.commission.publishCommission,
        {
          title: title.trim(),
          content: content.trim(),
          reward_points,
          deadline: deadline || ''
        },
        { idempotent: true }
      );
      if (!result.success) return { success: false, code: result.code, error: result.message || '发布失败' };
      return { success: true, commission_id: result.data && result.data.commission_id };
    } catch (error) {
      console.error('Failed to publish commission:', error);
      return { success: false, error: error.message || '发布失败' };
    }
  }

  async acceptCommission(commission_id) {
    if (!commission_id) return { success: false, error: '委托编号不能为空' };

    try {
      const result = await callFunction(
        CONFIG.api.commission.acceptCommission,
        { commission_id },
        { idempotent: true }
      );
      if (!result.success) return { success: false, code: result.code, error: result.message || '接取失败' };
      return { success: true, acceptance_id: result.data && result.data.acceptance_id };
    } catch (error) {
      console.error('Failed to accept commission:', error);
      return { success: false, error: error.message || '接取失败' };
    }
  }

  async completeCommission(acceptance_id) {
    if (!acceptance_id) return { success: false, error: '接取记录编号不能为空' };

    try {
      const result = await callFunction(
        CONFIG.api.commission.completeCommission,
        { acceptance_id },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '提交完成失败' };
      return { success: true };
    } catch (error) {
      console.error('Failed to complete commission:', error);
      return { success: false, error: error.message || '提交完成失败' };
    }
  }

  async allocateRewards(params = {}) {
    const { commission_id, acceptance_id, allocated_points } = params;
    if (!commission_id || !acceptance_id) return { success: false, error: '参数不完整' };
    if (!Number.isInteger(allocated_points) || allocated_points <= 0) return { success: false, error: '积分数量不合法' };

    try {
      const result = await callFunction(
        CONFIG.api.commission.allocateRewards,
        { commission_id, acceptance_id, allocated_points },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '奖励分配失败' };
      return { success: true };
    } catch (error) {
      console.error('Failed to allocate rewards:', error);
      return { success: false, error: error.message || '奖励分配失败' };
    }
  }
}

module.exports = new CommissionService();
