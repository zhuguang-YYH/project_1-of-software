const CONFIG = require('../config/index.js');
const { callCloudFunction } = require('./request.js');
const { storage } = require('./storage.js');

function normalizeUserInfo(userInfo = {}) {
  const userId = userInfo.user_id || userInfo._id || '';
  return {
    ...userInfo,
    _id: userId,
    user_id: userId,
    nickname: userInfo.nickname || '未知用户',
    avatar_url: userInfo.avatar_url || '',
    role: userInfo.role || 'user'
  };
}

class Auth {
  constructor() {
    this.userInfo = null;
    this.userId = null;
    this.loginPromise = null;
  }

  isLoggedIn() {
    const userInfo = storage.getUserInfo();
    return !!(userInfo && userInfo.user_id);
  }

  async wxLogin() {
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = new Promise((resolve, reject) => {
      wx.login({
        success: async (res) => {
          if (!res.code) {
            reject(new Error('获取登录凭证失败'));
            return;
          }

          try {
            const loginResult = await callCloudFunction('user_login', {
              code: res.code
            }, {
              timeout: CONFIG.timeout.login || 12000,
              retries: 1
            });

            if (!loginResult.success) {
              reject(new Error(loginResult.message || '登录失败'));
              return;
            }

            const userInfo = normalizeUserInfo(loginResult.data.userInfo || {});
            this.userId = userInfo.user_id;
            this.userInfo = userInfo;

            storage.setUserInfo(userInfo);
            storage.setToken(userInfo.user_id, CONFIG.cache.userInfoExpiry);

            resolve({
              success: true,
              data: {
                ...loginResult.data,
                userInfo,
                user_id: userInfo.user_id
              }
            });
          } catch (error) {
            reject(error);
          }
        },
        fail: reject
      });
    });

    try {
      return await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  async getUserInfo() {
    if (this.userInfo) return this.userInfo;

    const cachedInfo = storage.getUserInfo();
    if (cachedInfo && cachedInfo.user_id) {
      this.userInfo = normalizeUserInfo(cachedInfo);
      return this.userInfo;
    }

    try {
      const result = await callCloudFunction('user_getUserInfo', {});
      if (result.success) {
        this.userInfo = normalizeUserInfo(result.data || {});
        storage.setUserInfo(this.userInfo);
        return this.userInfo;
      }
    } catch (error) {
      console.error('Failed to get user info:', error);
    }

    return null;
  }

  async getUserProfile() {
    return new Promise((resolve, reject) => {
      wx.getUserProfile({
        desc: '用于完善个人侦探档案',
        success: (res) => resolve({ success: true, data: res.userInfo }),
        fail: reject
      });
    });
  }

  isAdmin() {
    const userInfo = storage.getUserInfo();
    return !!(userInfo && userInfo.role === 'admin');
  }

  hasPermission(permission) {
    const userInfo = storage.getUserInfo();
    if (!userInfo) return false;

    const permissionMap = {
      'admin.puzzle.manage': ['admin'],
      'admin.activity.manage': ['admin'],
      'admin.inventory.manage': ['admin'],
      'admin.exchange.manage': ['admin'],
      'admin.keyword.manage': ['admin'],
      'admin.feedback.manage': ['admin'],
      'admin.user.manage': ['admin'],
      'user.puzzle.answer': ['user', 'admin'],
      'user.activity.register': ['user', 'admin'],
      'user.borrow.apply': ['user', 'admin'],
      'user.exchange.redeem': ['user', 'admin'],
      'user.commission.publish': ['user', 'admin'],
      'user.feedback.submit': ['user', 'admin']
    };

    return (permissionMap[permission] || []).includes(userInfo.role);
  }

  async validateToken() {
    return this.isLoggedIn();
  }

  async refreshToken() {
    try {
      const result = await this.wxLogin();
      return result.success === true;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  }

  async logout() {
    try {
      await callCloudFunction('user_logout', {});
    } catch (error) {
      console.error('Logout error:', error);
    }

    this.userInfo = null;
    this.userId = null;
    storage.removeToken();
    storage.removeSync('user_info');
    return true;
  }

  async requestAuthorization(scope) {
    return new Promise((resolve) => {
      wx.authorize({
        scope,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    });
  }
}

const auth = new Auth();

module.exports = { auth };
