const puzzleService = require('../../services/puzzle.js');
const { applyTheme } = require('../../utils/theme.js');
const interaction = require('../../utils/interaction.js');

Page({
  data: {
    puzzles: [],
    loading: true,
    refreshing: false,
    loading_more: false,
    theme: 'blue',
    page: 1,
    hasMore: true,
    total: 0,
    error: ''
  },

  onLoad() {
    this.loadTheme();
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    this.loadPuzzles(true);
  },

  loadTheme() {
    applyTheme(this);
  },

  async initPage() {
    this.setData({ loading: true, error: '' });
    try {
      await this.loadPuzzles(true);
    } catch (err) {
      console.error('Failed to init favorites:', err);
      this.setData({ error: err.message || '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadPuzzles(reset = false) {
    if (reset) this.setData({ page: 1, hasMore: true, puzzles: [] });

    const { page, hasMore, loading_more } = this.data;
    if (!hasMore || loading_more) return;

    this.setData({ loading_more: true });

    try {
      const result = await puzzleService.getFavorites({
        page: reset ? 1 : page,
        page_size: 12
      });

      if (!result.success) {
        wx.showToast({ title: result.error || '加载失败', icon: 'none' });
        return;
      }

      const data = result.data || {};
      const newList = reset ? (data.list || []) : [...this.data.puzzles, ...(data.list || [])];

      this.setData({
        puzzles: newList,
        total: data.total || 0,
        hasMore: !!(data.has_more),
        page: data.page || 1
      });
    } catch (err) {
      console.error('Failed to load favorites:', err);
    } finally {
      this.setData({ loading_more: false });
    }
  },

  loadMore() {
    const { hasMore, loading_more } = this.data;
    if (!hasMore || loading_more) return;
    this.setData({ page: this.data.page + 1 }, () => {
      this.loadPuzzles(false);
    });
  },

  goToPractice(e) {
    const puzzle_id = e.currentTarget.dataset.puzzleId;
    if (!puzzle_id) return;
    wx.navigateTo({ url: `/pages/puzzle/practice?puzzle_id=${puzzle_id}` });
  },

  async removeFavorite(e) {
    const puzzle_id = e.currentTarget.dataset.puzzleId;
    if (!puzzle_id) return;

    wx.showModal({
      title: '取消收藏',
      content: '确定取消收藏这道谜题吗？',
      success: async (res) => {
        if (res.confirm) {
          const result = await puzzleService.toggleFavorite(puzzle_id);
          if (result.success) {
            const updated = this.data.puzzles.filter(p => p.puzzle_id !== puzzle_id);
            this.setData({ puzzles: updated, total: Math.max(0, this.data.total - 1) });
            wx.showToast({ title: '已取消收藏', icon: 'success', duration: 1500 });
          }
        }
      }
    });
  },

  async onPullDownRefresh() {
    if (!interaction.canRefresh(this)) return;
    this.setData({ refreshing: true });
    try {
      await this.loadPuzzles(true);
    } finally {
      interaction.finishRefresh(this);
      wx.stopPullDownRefresh();
    }
  },

  goToBank() {
    wx.navigateTo({ url: '/pages/puzzle/bank' });
  },

  onShareAppMessage() {
    return {
      title: 'NK推协谜题收藏',
      path: '/pages/puzzle/bank'
    };
  }
});
