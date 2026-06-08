const rankingService = require('../../services/ranking.js');
const profileService = require('../../services/profile.js');
const { storage } = require('../../utils/storage.js');
const { applyTheme } = require('../../utils/theme.js');

function normalizeRankUser(item = {}, index = 0) {
  const rank_no = Number(item.rank_no || index + 1);
  return {
    user_id: item.user_id || '',
    rank_no,
    nickname: item.nickname || 'Detective',
    avatar_url: item.avatar_url || '',
    total_points: Number(item.total_points || 0),
    meta: `No.${rank_no}`
  };
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePublicCard(data = {}, fallback = {}) {
  const interests = Array.isArray(data.interests)
    ? data.interests.join(', ')
    : String(data.interests || '');

  return {
    user_id: data.user_id || fallback.user_id || '',
    display_name: data.display_name || data.nickname || fallback.nickname || 'Detective',
    avatar_url: data.avatar_url || fallback.avatar_url || '',
    self_intro: data.self_intro || data.signature || 'No introduction yet.',
    interests,
    total_points: Number(data.total_points || fallback.total_points || 0),
    available_points: Number(data.available_points || 0),
    rank_no: Number(data.rank_no || fallback.rank_no || 0),
    created_text: formatDate(data.created_at || data.create_time)
  };
}

Page({
  data: {
    top_three: [],
    full_ranking: [],
    user_ranking: null,
    my_points: 0,
    theme: 'blue',
    rankingCardTheme: 'light',
    loading: true,
    refreshing: false,
    error: '',
    tab: 'full',
    show_card_modal: false,
    card_loading: false,
    selected_card: null
  },

  onLoad() {
    this.loadTheme();
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    this.loadMyRanking();
  },

  loadTheme() {
    applyTheme(this);
  },

  async initPage() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadTopThree(),
        this.loadFullRanking(),
        this.loadMyRanking()
      ]);
    } catch (err) {
      console.error('Failed to init ranking page:', err);
      this.setData({ error: err.message || 'Load ranking failed' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadTopThree() {
    try {
      const result = await rankingService.getTopThree();
      const list = Array.isArray(result.data) ? result.data : [];
      this.setData({ top_three: list.slice(0, 3).map(normalizeRankUser) });
    } catch (err) {
      console.error('Load top three failed:', err);
      this.setData({ top_three: [] });
    }
  },

  async loadFullRanking() {
    try {
      const result = await rankingService.getFullRanking({
        page: 1,
        page_size: 100
      });
      const list = result.data || [];
      this.setData({ full_ranking: list.map(normalizeRankUser) });
    } catch (err) {
      console.error('Load full ranking failed:', err);
      this.setData({ full_ranking: [] });
    }
  },

  async loadMyRanking() {
    const user_info = storage.getUserInfo();
    if (!user_info || !user_info.user_id) {
      this.setData({ user_ranking: null, my_points: 0 });
      return;
    }

    try {
      const result = await rankingService.getUserRanking();
      const user_ranking = normalizeRankUser(result.data || {}, 0);
      this.setData({
        user_ranking,
        my_points: user_ranking.total_points
      });
    } catch (err) {
      console.error('Load my ranking failed:', err);
    }
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    try {
      await Promise.all([
        this.loadTopThree(),
        this.loadFullRanking(),
        this.loadMyRanking()
      ]);
    } catch (err) {
      console.error('Pull refresh failed:', err);
    } finally {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    }
  },

  async openDetectiveCard(e) {
    const detail = e.detail || {};
    const dataset = (e.currentTarget && e.currentTarget.dataset) || {};
    const user_id = detail.user_id || dataset.user_id || '';
    const fallback = this.data.full_ranking.find(item => item.user_id === user_id)
      || this.data.top_three.find(item => item.user_id === user_id)
      || detail.user
      || {};

    if (!user_id) return;

    this.setData({
      show_card_modal: true,
      card_loading: true,
      selected_card: normalizePublicCard({}, fallback)
    });

    try {
      const result = await profileService.getPublicCard(user_id);
      this.setData({ selected_card: normalizePublicCard(result.data || {}, fallback) });
    } catch (err) {
      wx.showToast({ title: err.message || 'Load card failed', icon: 'none' });
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

  onRetry() {
    this.initPage();
  },

  onShareAppMessage() {
    return {
      title: 'NK推协 · 侦探排行榜',
      path: '/pages/ranking/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 侦探排行榜'
    };
  },

  noop() {}
});
