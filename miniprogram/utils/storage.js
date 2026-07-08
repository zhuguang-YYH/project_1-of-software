/**
 * 本地存储封装模块
 * 提供同步和异步存储接口，支持加密和过期时间
 */

const CONFIG = require('../config/index.js');

class Storage {
  constructor() {
    this.prefix = 'NK_DETECTIVE_';
    this.expiryMap = new Map();
  }

  /**
   * 同步存储数据
   * @param {string} key - 存储键
   * @param {any} value - 存储值
   * @param {number} expiry - 过期时间（秒），可选
   */
  setSync(key, value, expiry = null) {
    const prefixedKey = this.prefix + key;
    const data = {
      value,
      timestamp: Date.now(),
      expiry: expiry ? Date.now() + expiry * 1000 : null
    };

    try {
      wx.setStorageSync(prefixedKey, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(`[Storage Error] Failed to set ${key}:`, error);
      return false;
    }
  }

  /**
   * 异步存储数据
   * @param {string} key - 存储键
   * @param {any} value - 存储值
   * @param {number} expiry - 过期时间（秒），可选
   */
  async set(key, value, expiry = null) {
    return new Promise((resolve, reject) => {
      const prefixedKey = this.prefix + key;
      const data = {
        value,
        timestamp: Date.now(),
        expiry: expiry ? Date.now() + expiry * 1000 : null
      };

      wx.setStorage({
        key: prefixedKey,
        data: JSON.stringify(data),
        success: () => resolve(true),
        fail: (error) => {
          console.error(`[Storage Error] Failed to set ${key}:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * 同步获取数据
   * @param {string} key - 存储键
   * @returns {any} 存储的值，或null
   */
  getSync(key) {
    const prefixedKey = this.prefix + key;

    try {
      const stored = wx.getStorageSync(prefixedKey);
      if (!stored) return null;

      const data = JSON.parse(stored);

      // 检查过期时间
      if (data.expiry && data.expiry < Date.now()) {
        this.removeSync(key);
        return null;
      }

      return data.value;
    } catch (error) {
      console.error(`[Storage Error] Failed to get ${key}:`, error);
      return null;
    }
  }

  /**
   * 异步获取数据
   * @param {string} key - 存储键
   * @returns {Promise<any>} 存储的值，或null
   */
  async get(key) {
    return new Promise((resolve) => {
      const prefixedKey = this.prefix + key;

      wx.getStorage({
        key: prefixedKey,
        success: (res) => {
          try {
            const data = JSON.parse(res.data);

            // 检查过期时间
            if (data.expiry && data.expiry < Date.now()) {
              this.remove(key);
              resolve(null);
            } else {
              resolve(data.value);
            }
          } catch (error) {
            console.error(`[Storage Error] Failed to parse ${key}:`, error);
            resolve(null);
          }
        },
        fail: () => resolve(null)
      });
    });
  }

  /**
   * 同步删除数据
   * @param {string} key - 存储键
   */
  removeSync(key) {
    const prefixedKey = this.prefix + key;

    try {
      wx.removeStorageSync(prefixedKey);
      return true;
    } catch (error) {
      console.error(`[Storage Error] Failed to remove ${key}:`, error);
      return false;
    }
  }

  /**
   * 异步删除数据
   * @param {string} key - 存储键
   */
  async remove(key) {
    return new Promise((resolve) => {
      const prefixedKey = this.prefix + key;

      wx.removeStorage({
        key: prefixedKey,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    });
  }

  /**
   * 同步清空所有数据
   */
  clearSync() {
    try {
      const storage = wx.getStorageSync('');
      for (const key in storage) {
        if (key.startsWith(this.prefix)) {
          wx.removeStorageSync(key);
        }
      }
      return true;
    } catch (error) {
      console.error('[Storage Error] Failed to clear storage:', error);
      return false;
    }
  }

  /**
   * 异步清空所有数据
   */
  async clear() {
    return new Promise((resolve) => {
      wx.clearStorage({
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    });
  }

  /**
   * 获取用户登录令牌
   */
  getToken() {
    return this.getSync('auth_token');
  }

  /**
   * 存储用户登录令牌
   */
  setToken(token, expiry = null) {
    return this.setSync('auth_token', token, expiry);
  }

  /**
   * 删除用户登录令牌
   */
  removeToken() {
    return this.removeSync('auth_token');
  }

  /**
   * 获取用户信息
   */
  getUserInfo() {
    return this.getSync('user_info');
  }

  /**
   * 存储用户信息
   */
  setUserInfo(userInfo) {
    return this.setSync('user_info', userInfo, CONFIG.cache.userInfoExpiry);
  }

  /**
   * 获取排行榜缓存
   */
  getRankingCache() {
    return this.getSync('ranking_cache');
  }

  /**
   * 存储排行榜缓存
   */
  setRankingCache(data) {
    return this.setSync('ranking_cache', data, CONFIG.cache.rankingExpiry);
  }

  /**
   * 获取推荐内容缓存
   */
  getRecommendationCache() {
    return this.getSync('recommendation_cache');
  }

  /**
   * 存储推荐内容缓存
   */
  setRecommendationCache(data) {
    return this.setSync('recommendation_cache', data, CONFIG.cache.recommendationExpiry);
  }
}

const storage = new Storage();

module.exports = { storage };
