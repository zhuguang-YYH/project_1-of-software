const puzzleService = require('../../services/puzzle.js');
const rankingService = require('../../services/ranking.js');
const profileService = require('../../services/profile.js');
const recommendationService = require('../../services/recommendation.js');
const pointsService = require('../../services/points.js');
const { storage } = require('../../utils/storage');
const { applyTheme } = require('../../utils/theme.js');
const share = require('../../utils/share.js');
const { normalizePublicCard } = require('../../utils/public-card.js');

const DEFAULT_COVER = '/pages/exchange/images/goods-default.jpg';

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
    cover_url: item.cover_url || item.image_url || item.image || DEFAULT_COVER,
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
    error: '',
    show_card_modal: false,
    card_loading: false,
    selected_card: null
  },

  onLoad(options = {}) {
    share.rememberInviter(options);
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
      if (!result.success) {
        this.setData({ dailyPuzzle: null });
        return;
      }
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
    storage.setSync('ranking_target_tab', 'full', 5);
    wx.switchTab({ url: '/pages/ranking/index' });
  },

  async openRankingUser(e) {
    const detail = e.detail || {};
    const user_id = detail.user_id || '';
    const fallback = detail.user || this.data.topThree.find(item => item.user_id === user_id) || {};
    if (!user_id) return;

    this.setData({
      show_card_modal: true,
      card_loading: true,
      selected_card: normalizePublicCard({}, fallback)
    });

    try {
      const result = await profileService.getPublicCard(user_id);
      if (!result.success) throw new Error(result.error || '加载名片失败');
      this.setData({ selected_card: normalizePublicCard(result.data || {}, fallback) });
    } catch (err) {
      wx.showToast({ title: err.message || '加载名片失败', icon: 'none' });
    } finally {
      this.setData({ card_loading: false });
    }
  },

  closeCardModal() {
    this.setData({
      show_card_modal: false,
      selected_card: null,
      card_loading: false
    });
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
      path: share.appendShareParams('/pages/index/index')
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 侦探集结地',
      query: share.appendShareParams('').replace(/^\?/, '')
    };
  }
});
