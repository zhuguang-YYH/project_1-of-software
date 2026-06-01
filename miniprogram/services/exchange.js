const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class ExchangeService {
  async getProducts(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.exchange.getProducts, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize,
        keyword: options.keyword || '',
        category: options.category || ''
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取商品列表失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error('Failed to get products:', error);
      return { success: false, data: [], error: error.message || '获取商品列表失败' };
    }
  }

  async getProductDetail(item_id) {
    if (!item_id) return { success: false, error: '商品编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.exchange.getProductDetail, { item_id });
      if (!result.success) return { success: false, error: result.message || '获取商品详情失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get product detail:', error);
      return { success: false, error: error.message || '获取商品详情失败' };
    }
  }

  async exchange(item_id, quantity = 1) {
    if (!item_id) return { success: false, error: '商品编号不能为空' };
    if (!Number.isInteger(quantity) || quantity < 1) return { success: false, error: '兑换数量不合法' };

    try {
      const result = await callFunction(
        CONFIG.api.exchange.exchange,
        { item_id, quantity },
        { idempotent: true }
      );
      if (!result.success) {
        return {
          success: false,
          code: result.code,
          error: result.message || '兑换失败'
        };
      }
      return {
        success: true,
        exchange_id: result.data && result.data.exchange_id,
        pickup_code: result.data && result.data.pickup_code
      };
    } catch (error) {
      console.error('Failed to exchange:', error);
      return { success: false, error: error.message || '兑换失败' };
    }
  }

  async getExchangeHistory(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.exchange.getExchangeHistory, {
        page: options.page || 1,
        page_size: options.page_size || CONFIG.pagination.pageSize
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取兑换记录失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error('Failed to get exchange history:', error);
      return { success: false, data: [], error: error.message || '获取兑换记录失败' };
    }
  }
}

module.exports = new ExchangeService();
