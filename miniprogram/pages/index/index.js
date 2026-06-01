const { callCloudFunction } = require('../../utils/request');
const { storage } = require('../../utils/storage');

function normalizeRankUser(item, index) {
  const rankNo = Number(item.rank_no || index + 1);
  const score = Number(item.total_points || 0);

  return {
    user_id: item.user_id || '',
    rank_no: rankNo,
    nickname: item.nickname || '未设置昵称',
    avatar_url: item.avatar_url || '',
    total_points: score,
    meta: `第 ${rankNo} 名`
  };
}

function normalizeRecommendation(item) {
  return {
    id: item.recommendation_id || item._id || '',
    title: item.title || '推荐内容',
    cover_url: item.cover_url || '',
    category: item.category || item.type || ''
  };
}

Page({
  data: {
    isLoggedIn: false,
    userInfo: null,
    dailyPuzzle: null,
    topThree: [],
    recommendations: [],
    myPoints: 0,
    loading: true,
    refreshing: false,
    error: ''
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.checkLogin();
    this.refreshTopThree();
  },

  async initPage() {
    this.setData({ loading: true, error: '' });

    try {
      this.checkLogin();

      await Promise.all([
        this.loadDailyPuzzle(),
        this.loadTopThree(),
        this.loadRecommendations(),
        this.loadMyPoints()
      ]);
    } catch (err) {
      console.error('Failed to init home page:', err);
      this.setData({ error: err.message || '首页加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  checkLogin() {
    const userInfo = storage.getUserInfo();
    const isLoggedIn = !!(userInfo && userInfo.user_id);
    this.setData({
      isLoggedIn,
      userInfo: isLoggedIn ? userInfo : null
    });
  },

  async loadDailyPuzzle() {
    if (!this.data.isLoggedIn) {
      this.setData({ dailyPuzzle: null });
      return;
    }

    try {
      const result = await callCloudFunction('puzzle_getTodayPuzzle', {});
      const puzzle = result.data || result || {};
      this.setData({
        dailyPuzzle: {
          ...puzzle,
          answered: !!puzzle.answered
        }
      });
    } catch (err) {
      console.error('Load daily puzzle failed:', err);
      this.setData({ dailyPuzzle: null });
    }
  },

  async loadTopThree() {
    try {
      const result = await callCloudFunction('ranking_getTopThree', {});
      const list = Array.isArray(result.data) ? result.data : [];
      this.setData({ topThree: list.slice(0, 3).map(normalizeRankUser) });
    } catch (err) {
      console.error('Load top three failed:', err);
      this.setData({ topThree: [] });
    }
  },

  async loadRecommendations() {
    try {
      const result = await callCloudFunction('recommendation_getRecommendations', {
        limit: 5
      });
      const list = (result.data && result.data.list) || result.data || [];
      this.setData({
        recommendations: Array.isArray(list) ? list.slice(0, 3).map(normalizeRecommendation) : []
      });
    } catch (err) {
      console.error('Load recommendations failed:', err);
      this.setData({ recommendations: [] });
    }
  },

  async loadMyPoints() {
    if (!this.data.isLoggedIn) {
      this.setData({ myPoints: 0 });
      return;
    }

    try {
      const result = await callCloudFunction('points_getUserPoints', {});
      const account = result.data || result || {};
      this.setData({ myPoints: Number(account.available_points || 0) });
    } catch (err) {
      console.error('Load user points failed:', err);
    }
  },

  refreshTopThree() {
    this.loadTopThree();
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });

    try {
      await Promise.all([
        this.loadDailyPuzzle(),
        this.loadTopThree(),
        this.loadRecommendations(),
        this.loadMyPoints()
      ]);
    } catch (err) {
      console.error('Pull refresh failed:', err);
    } finally {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    }
  },

  goToPuzzle() {
    if (!this.data.isLoggedIn) {
      this.navigateToLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/puzzle/index' });
  },

  goToRanking() {
    wx.navigateTo({ url: '/pages/ranking/index' });
  },

  openRankingUser() {
    wx.navigateTo({ url: '/pages/ranking/index' });
  },

  goToRecommendations() {
    wx.navigateTo({ url: '/pages/recommendation/index' });
  },

  goToRecommendationDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/recommendation/index?highlight=${id}` });
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  goToActivity() {
    wx.navigateTo({ url: '/pages/activity/index' });
  },

  goToDud() {
    wx.navigateTo({ url: '/pages/dud/index' });
  },

  navigateToLogin() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  onRetry() {
    this.initPage();
  }
});
