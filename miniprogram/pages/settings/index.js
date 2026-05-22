const { auth } = require('../../utils/auth');
const { storage } = require('../../utils/storage');

const DEFAULT_SETTINGS = {
  puzzle_reminder: true,
  activity_reminder: true,
  borrow_reminder: true,
  commission_reminder: true,
  show_ranking: true,
  show_profile_card: true,
  compact_mode: false
};

Page({
  data: {
    loading: true,
    userInfo: null,
    settings: { ...DEFAULT_SETTINGS },
    cacheText: '未计算'
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.loadUserInfo();
  },

  initPage() {
    this.loadUserInfo();
    this.loadSettings();
    this.updateCacheText();
    this.setData({ loading: false });
  },

  loadUserInfo() {
    this.setData({ userInfo: storage.getUserInfo() });
  },

  loadSettings() {
    const saved = storage.getSync('user_settings') || {};
    this.setData({
      settings: {
        ...DEFAULT_SETTINGS,
        ...saved
      }
    });
  },

  saveSettings(settings) {
    storage.setSync('user_settings', settings);
    this.setData({ settings });
  },

  onSettingChange(e) {
    const field = e.currentTarget.dataset.field;
    this.saveSettings({
      ...this.data.settings,
      [field]: e.detail.value
    });
  },

  updateCacheText() {
    try {
      const info = wx.getStorageInfoSync();
      this.setData({ cacheText: `${info.currentSize || 0} KB` });
    } catch (err) {
      this.setData({ cacheText: '无法读取' });
    }
  },

  clearCache() {
    wx.showModal({
      title: '清理缓存',
      content: '将清理排行榜、推荐内容等本地缓存，不会退出登录。',
      confirmText: '清理',
      success: (res) => {
        if (!res.confirm) return;
        storage.removeSync('ranking_cache');
        storage.removeSync('recommendation_cache');
        this.updateCacheText();
        wx.showToast({ title: '已清理', icon: 'success' });
      }
    });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能使用答题、报名、借阅、兑换等功能。',
      confirmText: '退出',
      confirmColor: '#d93025',
      success: async (res) => {
        if (!res.confirm) return;
        await auth.logout();
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.userInfo = null;
          app.globalData.userId = null;
          app.globalData.isLoggedIn = false;
        }
        this.setData({ userInfo: null });
        wx.showToast({ title: '已退出', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/profile/index' });
        }, 400);
      }
    });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/index' });
  }
});
