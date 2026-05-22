const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class BorrowService {
  async getItems(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.borrow.getItems, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        item_type: options.item_type || '',
        campus: options.campus || '',
        status: options.status || 'available',
        keyword: options.keyword || ''
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取物资列表失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        page: result.data && result.data.page,
        page_size: result.data && result.data.page_size,
        has_more: result.data && result.data.has_more
      };
    } catch (error) {
      console.error('Failed to get borrow items:', error);
      return { success: false, data: [], error: error.message || '获取物资列表失败' };
    }
  }

  async getItemDetail(item_id) {
    if (!item_id) return { success: false, error: '物资编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.borrow.getItemDetail, { item_id });
      if (!result.success) return { success: false, error: result.message || '获取物资详情失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get item detail:', error);
      return { success: false, error: error.message || '获取物资详情失败' };
    }
  }

  async applyBorrow(item_id, options = {}) {
    if (!item_id) return { success: false, error: '物资编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.borrow.applyBorrow, {
        item_id,
        reason: options.reason || '',
        expected_return_date: options.expected_return_date || ''
      });

      if (!result.success) return { success: false, error: result.message || '申请借阅失败' };
      return {
        success: true,
        application_id: result.data && result.data.application_id,
        borrow_id: result.data && result.data.borrow_id
      };
    } catch (error) {
      console.error('Failed to apply borrow:', error);
      return { success: false, error: error.message || '申请借阅失败' };
    }
  }

  async cancelBorrow(application_id) {
    if (!application_id) return { success: false, error: '借阅申请编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.borrow.cancelBorrow, { application_id });
      if (!result.success) return { success: false, error: result.message || '取消借阅失败' };
      return { success: true, message: '已取消借阅申请' };
    } catch (error) {
      console.error('Failed to cancel borrow:', error);
      return { success: false, error: error.message || '取消借阅失败' };
    }
  }

  async getBorrowHistory(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.borrow.getBorrowHistory, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        status: options.status || '',
        item_type: options.item_type || ''
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取借阅历史失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        page: result.data && result.data.page,
        page_size: result.data && result.data.page_size,
        has_more: result.data && result.data.has_more
      };
    } catch (error) {
      console.error('Failed to get borrow history:', error);
      return { success: false, data: [], error: error.message || '获取借阅历史失败' };
    }
  }

  async getScripts(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.borrow.getScripts, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        genre: options.genre || '',
        min_players: options.min_players || '',
        max_players: options.max_players || '',
        difficulty: options.difficulty || '',
        status: options.status || 'available'
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取剧本杀列表失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        page: result.data && result.data.page,
        page_size: result.data && result.data.page_size,
        has_more: result.data && result.data.has_more
      };
    } catch (error) {
      console.error('Failed to get scripts:', error);
      return { success: false, data: [], error: error.message || '获取剧本杀列表失败' };
    }
  }

  async getBorrowStats() {
    try {
      const result = await callFunction('borrow_getStats', {});
      if (!result.success) return { success: false, data: {} };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get borrow stats:', error);
      return { success: false, data: {} };
    }
  }

  async getItemInTransitInfo(item_id) {
    if (!item_id) return { success: false, error: '物资编号不能为空' };

    try {
      const result = await callFunction('borrow_getInTransitInfo', { item_id });
      if (!result.success) return { success: false, data: {}, error: result.message || '获取传递中信息失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get in-transit info:', error);
      return { success: false, data: {}, error: error.message || '获取传递中信息失败' };
    }
  }
}

module.exports = new BorrowService();
