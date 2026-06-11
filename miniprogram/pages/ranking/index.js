const rankingService = require('../../services/ranking.js');
const profileService = require('../../services/profile.js');
const { storage } = require('../../utils/storage.js');
const { applyTheme } = require('../../utils/theme.js');
const share = require('../../utils/share.js');
const { normalizePublicCard } = require('../../utils/public-card.js');

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

  onLoad(options = {}) {
    share.rememberInviter(options);
    if (options.tab && ['top3', 'full', 'my'].includes(options.tab)) {
      this.setData({ tab: options.tab });
    }
    this.loadTheme();
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    this.applyTargetTab();
    this.loadMyRanking();
  },

  loadTheme() {
    applyTheme(this);
  },

  applyTargetTab() {
    const target_tab = storage.getSync('ranking_target_tab');
    if (!target_tab || !['top3', 'full', 'my'].includes(target_tab)) return;
    storage.removeSync('ranking_target_tab');
    if (this.data.tab !== target_tab) {
      this.setData({ tab: target_tab });
    }
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
    const rank = this.data.user_ranking && this.data.user_ranking.rank_no;
    const title = rank
      ? `我在 NK推协侦探排行榜第 ${rank} 名`
      : 'NK推协 · 侦探排行榜';
    return {
      title,
      path: share.appendShareParams('/pages/ranking/index', { tab: 'my' })
    };
  },

  onShareTimeline() {
    const rank = this.data.user_ranking && this.data.user_ranking.rank_no;
    return {
      title: rank ? `我在 NK推协侦探排行榜第 ${rank} 名` : 'NK推协 · 侦探排行榜',
      query: share.appendShareParams('', { tab: 'my' }).replace(/^\?/, '')
    };
  },

  noop() {}
});
