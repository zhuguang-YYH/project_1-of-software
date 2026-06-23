const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class DatingService {
  async getDailyStatus() {
    try {
      const result = await callFunction(CONFIG.api.dating.getDailyStatus, {});
      if (!result.success) return { success: false, error: result.message || '获取交友状态失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get dating daily status:', error);
      return { success: false, error: error.message || '获取交友状态失败' };
    }
  }

  async getProfiles() {
    try {
      const result = await callFunction(CONFIG.api.dating.getProfiles, {});
      if (!result.success) return { success: false, error: result.message || '获取推荐失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get dating profiles:', error);
      return { success: false, error: error.message || '获取推荐失败' };
    }
  }

  async swipe(target_user_id, action) {
    if (!target_user_id || !action) return { success: false, error: '参数不完整' };
    try {
      const result = await callFunction(
        CONFIG.api.dating.swipe,
        { target_user_id, action },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '操作失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to swipe:', error);
      return { success: false, error: error.message || '操作失败' };
    }
  }

  async getMatches() {
    try {
      const result = await callFunction(CONFIG.api.dating.getMatches, {});
      if (!result.success) return { success: false, error: result.message || '获取匹配列表失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get matches:', error);
      return { success: false, error: error.message || '获取匹配列表失败' };
    }
  }

  async getMatchDetail(match_id) {
    if (!match_id) return { success: false, error: '缺少匹配编号' };
    try {
      const result = await callFunction(CONFIG.api.dating.getMatchDetail, { match_id });
      if (!result.success) return { success: false, error: result.message || '获取匹配详情失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get match detail:', error);
      return { success: false, error: error.message || '获取匹配详情失败' };
    }
  }

  async updatePreferences(prefs = {}) {
    try {
      const result = await callFunction(CONFIG.api.dating.updatePreferences, prefs, { idempotent: true });
      if (!result.success) return { success: false, error: result.message || '更新偏好失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to update dating preferences:', error);
      return { success: false, error: error.message || '更新偏好失败' };
    }
  }

  async joinPool() {
    try {
      const result = await callFunction(CONFIG.api.dating.joinPool, {}, { idempotent: true });
      if (!result.success) return { success: false, error: result.message || '加入交友池失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to join dating pool:', error);
      return { success: false, error: error.message || '加入交友池失败' };
    }
  }

  async leavePool() {
    try {
      const result = await callFunction(CONFIG.api.dating.leavePool, {}, { idempotent: true });
      if (!result.success) return { success: false, error: result.message || '退出交友池失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to leave dating pool:', error);
      return { success: false, error: error.message || '退出交友池失败' };
    }
  }

  async unmatch(match_id) {
    if (!match_id) return { success: false, error: '缺少匹配编号' };
    try {
      const result = await callFunction(CONFIG.api.dating.unmatch, { match_id }, { idempotent: true });
      if (!result.success) return { success: false, error: result.message || '解除匹配失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to unmatch:', error);
      return { success: false, error: error.message || '解除匹配失败' };
    }
  }

  // ========== 游戏邀请 ==========

  async sendInvitation({ to_user_id, match_id, game_type, game_name, message }) {
    if (!to_user_id || !match_id || !game_type) return { success: false, error: '参数不完整' };
    try {
      const result = await callFunction(
        CONFIG.api.dating.sendInvitation,
        { to_user_id, match_id, game_type, game_name, message },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '发送邀请失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to send invitation:', error);
      return { success: false, error: error.message || '发送邀请失败' };
    }
  }

  async getInvitations(filter = 'all') {
    try {
      const result = await callFunction(CONFIG.api.dating.getInvitations, { filter });
      if (!result.success) return { success: false, error: result.message || '获取邀请列表失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get invitations:', error);
      return { success: false, error: error.message || '获取邀请列表失败' };
    }
  }

  async respondInvitation(invitation_id, action) {
    if (!invitation_id || !action) return { success: false, error: '参数不完整' };
    try {
      const result = await callFunction(
        CONFIG.api.dating.respondInvitation,
        { invitation_id, action },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '操作失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to respond invitation:', error);
      return { success: false, error: error.message || '操作失败' };
    }
  }

  // ========== 好友聊天 ==========

  async sendMessage({ match_id, to_user_id, content_type, content, game_data }) {
    if (!match_id || !to_user_id || !content_type) return { success: false, error: '参数不完整' };
    try {
      const result = await callFunction(
        CONFIG.api.dating.sendMessage,
        { match_id, to_user_id, content_type, content, game_data },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '发送失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to send message:', error);
      return { success: false, error: error.message || '发送失败' };
    }
  }

  async getMessages(match_id, options = {}) {
    if (!match_id) return { success: false, error: '缺少匹配编号' };
    try {
      const result = await callFunction(CONFIG.api.dating.getMessages, {
        match_id,
        page: options.page || 1,
        page_size: options.page_size || 30
      });
      if (!result.success) return { success: false, error: result.message || '获取消息失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get messages:', error);
      return { success: false, error: error.message || '获取消息失败' };
    }
  }

  async getConversations() {
    try {
      const result = await callFunction(CONFIG.api.dating.getConversations, {});
      if (!result.success) return { success: false, error: result.message || '获取会话列表失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get conversations:', error);
      return { success: false, error: error.message || '获取会话列表失败' };
    }
  }

  // ========== 好友请求 ==========

  async sendFriendRequest(to_user_id, message) {
    if (!to_user_id) return { success: false, error: '缺少目标用户编号' };
    try {
      const result = await callFunction(
        CONFIG.api.dating.sendFriendRequest,
        { to_user_id, message },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '发送好友请求失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to send friend request:', error);
      return { success: false, error: error.message || '发送好友请求失败' };
    }
  }

  async getFriendRequests() {
    try {
      const result = await callFunction(CONFIG.api.dating.getFriendRequests, {});
      if (!result.success) return { success: false, error: result.message || '获取好友请求失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to get friend requests:', error);
      return { success: false, error: error.message || '获取好友请求失败' };
    }
  }

  async respondFriendRequest(request_id, action) {
    if (!request_id || !action) return { success: false, error: '参数不完整' };
    try {
      const result = await callFunction(
        CONFIG.api.dating.respondFriendRequest,
        { request_id, action },
        { idempotent: true }
      );
      if (!result.success) return { success: false, error: result.message || '操作失败' };
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Failed to respond friend request:', error);
      return { success: false, error: error.message || '操作失败' };
    }
  }
}

module.exports = new DatingService();
