const puzzleService = require('../../services/puzzle.js');
const rankingService = require('../../services/ranking.js');
const profileService = require('../../services/profile.js');
const recommendationService = require('../../services/recommendation.js');
const pointsService = require('../../services/points.js');
const datingService = require('../../services/dating.js');
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
    banners: [],
    announcement: null,
    checkedInToday: false,
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
        this.loadMyPoints(),
        this.loadBanners(),
        this.loadAnnouncement()
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
      // Check if already checked in today
      if (result.last_checkin_date) {
        const today = new Date().toISOString().split('T')[0];
        this.setData({ checkedInToday: result.last_checkin_date === today });
      }
    } catch (err) {
      console.error('Load user points failed:', err);
    }
  },

  async onDailyCheckin() {
    if (this.data.checkedInToday) {
      wx.showToast({ title: '今日已签到', icon: 'none' });
      return;
    }
    if (!this.data.isLoggedIn) {
      this.navigateToLogin();
      return;
    }
    try {
      const result = await pointsService.dailyCheckin();
      if (!result.success) throw new Error(result.error || '签到失败');
      wx.showToast({ title: `签到成功！+${result.data.points || 5} 积分`, icon: 'success' });
      this.setData({
        checkedInToday: true,
        myPoints: this.data.myPoints + (result.data.points || 5)
      });
    } catch (err) {
      wx.showToast({ title: err.message || '签到失败', icon: 'none' });
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
        this.loadMyPoints(),
        this.loadBanners(),
        this.loadAnnouncement()
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
      const userInfo = storage.getUserInfo();
      const myId = (userInfo && userInfo.user_id) || '';
      const result = await profileService.getPublicCard(user_id);
      if (!result.success) throw new Error(result.error || '加载名片失败');
      const card = normalizePublicCard(result.data || {}, fallback);
      card.is_self = myId === user_id;
      if (!card.is_self && myId) {
        try {
          const frResult = await datingService.getFriendRequests();
          if (frResult.success) {
            const data = frResult.data || {};
            card.is_friend = !!(data.friend_ids || []).includes(user_id);
            card.request_pending = !!(data.pending_sent_ids || []).includes(user_id);
          }
        } catch (_) { /* ignore */ }
      }
      this.setData({ selected_card: card });
    } catch (err) {
      wx.showToast({ title: err.message || '加载名片失败', icon: 'none' });
    } finally {
      this.setData({ card_loading: false });
    }
  },

  async onAddFriend(e) {
    const user_id = e.detail.user_id;
    if (!user_id) return;

    try {
      const result = await datingService.sendFriendRequest(user_id);
      if (!result.success) throw new Error(result.error || '发送失败');

      wx.showToast({ title: '好友请求已发送', icon: 'success' });
      // 更新卡片状态
      const card = { ...this.data.selected_card, request_pending: true };
      this.setData({ selected_card: card });
    } catch (err) {
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
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

  goToPuzzleBank() {
    wx.navigateTo({ url: '/pages/puzzle/bank' });
  },

  goToDating() {
    if (!this.data.isLoggedIn) {
      this.navigateToLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/dating/matches' });
  },

  navigateToLogin() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  async loadBanners() {
    try {
      const result = await recommendationService.getBanners();
      const list = result.data || [];
      this.setData({ banners: Array.isArray(list) ? list : [] });
    } catch (_) {
      this.setData({ banners: [] });
    }
  },

  async loadAnnouncement() {
    try {
      const result = await recommendationService.getAnnouncement();
      this.setData({ announcement: (result.success && result.data) || null });
    } catch (_) {
      this.setData({ announcement: null });
    }
  },

  onBannerTap(e) {
    const { url, type } = e.currentTarget.dataset;
    if (!url) return;
    if (type === 'miniprogram') {
      wx.navigateTo({ url, fail: () => {} });
    } else if (type === 'page') {
      wx.navigateTo({ url, fail: () => {} });
    } else {
      // webview or external - copy link for now
      wx.setClipboardData({ data: url, success: () => wx.showToast({ title: '链接已复制', icon: 'none' }) });
    }
  },

  onAnnouncementTap() {
    const announcement = this.data.announcement;
    if (!announcement) return;
    if (announcement.link_url) {
      wx.navigateTo({ url: announcement.link_url, fail: () => {
        wx.showModal({ title: announcement.title || '公告', content: announcement.content || '', showCancel: false });
      }});
    } else {
      wx.showModal({ title: announcement.title || '公告', content: announcement.content || '', showCancel: false });
    }
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
