const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');
const { storage } = require('../utils/storage.js');
const share = require('../utils/share.js');

function normalizeUserInfo(userInfo = {}) {
  const user_id = userInfo.user_id || userInfo._id || '';
  return {
    ...userInfo,
    _id: user_id,
    user_id,
    nickname: userInfo.nickname || '未知用户',
    avatar_url: userInfo.avatar_url || '',
    role: userInfo.role || 'user'
  };
}

class UserService {
  async login(params = {}) {
    try {
      const result = await callFunction(CONFIG.api.user.login, {
        ...params,
        inviter_id: params.inviter_id || share.getPendingInviterId()
      }, {
        timeout: CONFIG.timeout.login || CONFIG.timeout.default
      });
      if (!result.success) return { success: false, error: result.message || '登录失败' };

      const userInfo = normalizeUserInfo((result.data && result.data.userInfo) || result.data || {});
      if (userInfo.user_id) {
        storage.setUserInfo(userInfo);
        storage.setToken(userInfo.user_id, CONFIG.cache.userInfoExpiry);
      }

      return {
        success: true,
        data: {
          ...(result.data || {}),
          userInfo,
          user_id: userInfo.user_id
        }
      };
    } catch (error) {
      console.error('Failed to login:', error);
      return { success: false, error: error.message || '登录失败' };
    }
  }

  async getUserInfo(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.user.getUserInfo, {});
      if (!result.success) return { success: false, error: result.message || '获取用户信息失败' };

      const userInfo = normalizeUserInfo(result.data || {});
      if (options.cache !== false && userInfo.user_id) {
        storage.setUserInfo(userInfo);
      }
      return { success: true, data: userInfo };
    } catch (error) {
      console.error('Failed to get user info:', error);
      return { success: false, error: error.message || '获取用户信息失败' };
    }
  }

  async updateProfile(profile = {}) {
    try {
      const result = await callFunction(CONFIG.api.user.updateProfile, profile);
      if (!result.success) return { success: false, error: result.message || '保存资料失败' };

      const userInfo = normalizeUserInfo(result.data || profile);
      if (userInfo.user_id) storage.setUserInfo(userInfo);
      return { success: true, data: userInfo };
    } catch (error) {
      console.error('Failed to update profile:', error);
      return { success: false, error: error.message || '保存资料失败' };
    }
  }

  async logout() {
    try {
      await callFunction(CONFIG.api.user.logout, {});
    } catch (error) {
      console.error('Failed to logout:', error);
    }

    storage.removeToken();
    storage.removeSync('user_info');
    return { success: true };
  }
}

module.exports = new UserService();
