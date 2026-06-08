const puzzleService = require('../../services/puzzle.js');
const rankingService = require('../../services/ranking.js');
const recommendationService = require('../../services/recommendation.js');
const pointsService = require('../../services/points.js');
const { storage } = require('../../utils/storage');
const { applyTheme } = require('../../utils/theme.js');

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
    theme: 'blue',
    rankingCardTheme: 'light',
    loading: true,
    refreshing: false,
    error: ''
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    this.checkLogin();
    this.refreshTopThree();
  },

  async initPage() {
    this.setData({ loading: true, error: '' });

    try {
      this.loadTheme();
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

  loadTheme() {
    applyTheme(this);
  },

  async loadDailyPuzzle() {
    if (!this.data.isLoggedIn) {
      this.setData({ dailyPuzzle: null });
      return;
    }

    try {
      const result = await puzzleService.getTodayPuzzle();
      const puzzle = result.data || {};
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
      const result = await rankingService.getTopThree();
      const list = Array.isArray(result.data) ? result.data : [];
      this.setData({ topThree: list.slice(0, 3).map(normalizeRankUser) });
    } catch (err) {
      console.error('Load top three failed:', err);
      this.setData({ topThree: [] });
    }
  },

  async loadRecommendations() {
    try {
      const result = await recommendationService.getRecommendations({
        page_size: 5
      });
      const list = result.data || [];
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
      const result = await pointsService.getUserPoints();
      this.setData({ myPoints: Number(result.available_points || 0) });
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
  },

  onShareAppMessage() {
    return {
      title: 'NK推协 · 侦探集结地',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 侦探集结地'
    };
  }
});
