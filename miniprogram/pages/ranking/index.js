const rankingService = require('../../services/ranking.js');
const profileService = require('../../services/profile.js');
const datingService = require('../../services/dating.js');
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
    period: 'all',
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
      const result = await rankingService.getTopThree({ period: this.data.period });
      const list = Array.isArray(result.data) ? result.data : [];
      const ranked = list.slice(0, 3).map(normalizeRankUser);
      // Always pad to 3 positions so the podium layout is complete
      while (ranked.length < 3) {
        ranked.push({ user_id: '', rank_no: ranked.length + 1, nickname: '虚位以待', avatar_url: '', total_points: 0, _placeholder: true });
      }
      this.setData({ top_three: ranked });
    } catch (err) {
      console.error('Load top three failed:', err);
      this.setData({ top_three: [] });
    }
  },

  async loadFullRanking() {
    try {
      const result = await rankingService.getFullRanking({
        page: 1,
        page_size: 100,
        period: this.data.period
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
      const result = await rankingService.getUserRanking(this.data.period);
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

  switchPeriod(e) {
    const period = e.currentTarget.dataset.period;
    if (period === this.data.period) return;
    this.setData({ period, loading: true });
    this.initPage();
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
      const userInfo = storage.getUserInfo();
      const myId = (userInfo && userInfo.user_id) || '';
      const result = await profileService.getPublicCard(user_id);
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
      wx.showToast({ title: err.message || 'Load card failed', icon: 'none' });
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
