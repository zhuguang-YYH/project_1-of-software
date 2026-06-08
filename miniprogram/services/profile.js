const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class ProfileService {
  async getCard() {
    try {
      const result = await callFunction(CONFIG.api.profile.getCard, {});
      if (!result.success) return { success: false, data: null, error: result.message || '获取名片失败' };
      return { success: true, data: result.data || null };
    } catch (error) {
      console.error('Failed to get profile card:', error);
      return { success: false, data: null, error: error.message || '获取名片失败' };
    }
  }

  async getPublicCard(user_id) {
    if (!user_id) return { success: false, data: null, error: '用户编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.profile.getPublicCard, { user_id });
      if (!result.success) return { success: false, data: null, error: result.message || '获取公开名片失败' };
      return { success: true, data: result.data || null };
    } catch (error) {
      console.error('Failed to get public card:', error);
      return { success: false, data: null, error: error.message || '获取公开名片失败' };
    }
  }

  async updateCard(card = {}) {
    try {
      const result = await callFunction(CONFIG.api.profile.updateCard, card);
      if (!result.success) return { success: false, error: result.message || '保存名片失败' };
      return { success: true, data: result.data || null };
    } catch (error) {
      console.error('Failed to update profile card:', error);
      return { success: false, error: error.message || '保存名片失败' };
    }
  }

  async getMyPoints() {
    try {
      const result = await callFunction(CONFIG.api.profile.getMyPoints, {});
      if (!result.success) return { success: false, data: {}, error: result.message || '获取积分失败' };
      return { success: true, data: result.data || {} };
    } catch (error) {
      console.error('Failed to get profile points:', error);
      return { success: false, data: {}, error: error.message || '获取积分失败' };
    }
  }
}

module.exports = new ProfileService();
