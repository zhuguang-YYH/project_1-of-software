const CONFIG = require('./config/index.js');
const { auth } = require('./utils/auth.js');

App({
  globalData: {
    userInfo: null,
    userId: null,
    isLoggedIn: false,
    systemInfo: null,
    env: CONFIG.cloudEnv
  },

  onLaunch() {
    this.initCloud();
    this.initSystemInfo();
    this.autoLogin();
  },

  initCloud() {
    if (!wx.cloud) {
      console.warn('Cloud service is not available');
      return;
    }

    wx.cloud.init({
      env: CONFIG.cloudEnvId,
      traceUser: true
    });
  },

  initSystemInfo() {
    wx.getSystemInfo({
      success: (res) => {
        this.globalData.systemInfo = res;
      }
    });
  },

  async autoLogin() {
    try {
      let userInfo = null;

      if (auth.isLoggedIn()) {
        userInfo = await auth.getUserInfo();
      } else {
        const result = await auth.wxLogin();
        userInfo = result.success ? result.data.userInfo : null;
      }

      if (userInfo && userInfo.user_id) {
        this.globalData.userInfo = userInfo;
        this.globalData.userId = userInfo.user_id;
        this.globalData.isLoggedIn = true;
      }
    } catch (error) {
      console.error('Auto login failed:', error);
      this.globalData.isLoggedIn = false;
    }
  },

  onShow() {
    this.checkTokenExpiry();
  },

  onError(error) {
    console.error('App error:', error);
    this.reportError(error);
  },

  onPageNotFound() {
    wx.navigateTo({ url: '/pages/index/index' });
  },

  async checkTokenExpiry() {
    if (!auth.isLoggedIn()) return;

    const isValid = await auth.validateToken();
    if (!isValid) {
      const refreshed = await auth.refreshToken();
      if (!refreshed) this.globalData.isLoggedIn = false;
    }
  },

  reportError(error) {
    try {
      wx.cloud.callFunction({
        name: 'error_report',
        data: {
          error: {
            message: error.message,
            stack: error.stack,
            timestamp: Date.now(),
            url: (getCurrentPages().pop() || {}).route || 'unknown'
          }
        }
      });
    } catch (e) {
      console.error('Failed to report error:', e);
    }
  },

  getUserInfo() {
    return this.globalData.userInfo;
  },

  isLoggedIn() {
    return this.globalData.isLoggedIn;
  },

  getSystemInfo() {
    return this.globalData.systemInfo;
  }
});
