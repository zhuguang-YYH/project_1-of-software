const CONFIG = require('./config/index.js');
const { auth } = require('./utils/auth.js');

App({
  globalData: {
    userInfo: null,
    userId: null,
    isLoggedIn: false,
    systemInfo: null,
    env: CONFIG.cloudEnv,
    lastError: null
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
    console.error('[App onError]', error);
    this.recordError('js_error', error);
  },

  onUnhandledRejection(res) {
    console.error('[App onUnhandledRejection]', res && res.reason);
    this.recordError('unhandled_rejection', res && res.reason);
  },

  onPageNotFound(res) {
    console.warn('[App onPageNotFound]', res && res.path);
    // 兜底跳回首页（首页是 tabBar 页面，必须用 switchTab）
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    });
  },

  async checkTokenExpiry() {
    if (!auth.isLoggedIn()) return;

    const isValid = await auth.validateToken();
    if (!isValid) {
      const refreshed = await auth.refreshToken();
      if (!refreshed) this.globalData.isLoggedIn = false;
    }
  },

  // 仅本地记录最近一次错误，供反馈页或调试用；不再调用未部署的 error_report 云函数
  recordError(type, error) {
    try {
      const message = error && (error.message || error.errMsg) || String(error || '');
      const stack = error && error.stack ? String(error.stack).slice(0, 2000) : '';
      const page = (getCurrentPages().pop() || {}).route || 'unknown';
      this.globalData.lastError = {
        type,
        message,
        stack,
        page,
        timestamp: Date.now()
      };
    } catch (e) {
      // 防止错误上报本身再次抛错
    }
  },

  getLastError() {
    return this.globalData.lastError;
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
