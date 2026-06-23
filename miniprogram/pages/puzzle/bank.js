const puzzleService = require('../../services/puzzle.js');
const { applyTheme } = require('../../utils/theme.js');
const interaction = require('../../utils/interaction.js');

Page({
  data: {
    puzzles: [],
    categories: [],
    loading: true,
    refreshing: false,
    loading_more: false,
    theme: 'blue',
    activeCategory: '',
    activeDifficulty: '',
    searchKeyword: '',
    sortBy: 'date',
    sortOrder: 'desc',
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
  },

  loadTheme() {
    applyTheme(this);
  },

  async initPage() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadCategories(),
        this.loadPuzzles(true)
      ]);
    } catch (err) {
      console.error('Failed to init puzzle bank:', err);
      this.setData({ error: err.message || '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadCategories() {
    try {
      const result = await puzzleService.getPuzzleCategories();
      if (result.success) {
        this.setData({ categories: result.data || [] });
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  },

  async loadPuzzles(reset = false) {
    if (reset) this.setData({ page: 1, hasMore: true, puzzles: [] });

    const { page, hasMore, loading_more } = this.data;
    if (!hasMore || loading_more) return;

    this.setData({ loading_more: true });

    try {
      const result = await puzzleService.getPuzzleBank({
        page: reset ? 1 : page,
        page_size: 12,
        category: this.data.activeCategory,
        difficulty: this.data.activeDifficulty,
        sort_by: this.data.sortBy,
        sort_order: this.data.sortOrder,
        keyword: this.data.searchKeyword
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
      console.error('Failed to load puzzle bank:', err);
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

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value || '' });
  },

  onSearch() {
    this.loadPuzzles(true);
  },

  onCategoryFilter(e) {
    const category = e.currentTarget.dataset.category || '';
    if (category === this.data.activeCategory) return;
    this.setData({ activeCategory: category }, () => {
      this.loadPuzzles(true);
    });
  },

  onDifficultyFilter(e) {
    const difficulty = e.currentTarget.dataset.difficulty || '';
    if (difficulty === this.data.activeDifficulty) return;
    this.setData({ activeDifficulty: difficulty }, () => {
      this.loadPuzzles(true);
    });
  },

  onSortChange(e) {
    const { sort } = e.currentTarget.dataset;
    if (!sort) return;
    const [sortBy, sortOrder] = sort.split(':');
    this.setData({ sortBy, sortOrder }, () => {
      this.loadPuzzles(true);
    });
  },

  goToPractice(e) {
    const puzzle_id = e.currentTarget.dataset.puzzleId;
    if (!puzzle_id) return;
    wx.navigateTo({ url: `/pages/puzzle/practice?puzzle_id=${puzzle_id}` });
  },

  goToFavorites() {
    wx.navigateTo({ url: '/pages/puzzle/favorites' });
  },

  async onPullDownRefresh() {
    if (!interaction.canRefresh(this)) return;
    this.setData({ refreshing: true });
    try {
      await Promise.all([
        this.loadCategories(),
        this.loadPuzzles(true)
      ]);
    } finally {
      interaction.finishRefresh(this);
      wx.stopPullDownRefresh();
    }
  },

  onShareAppMessage() {
    return {
      title: 'NK推协谜题库',
      path: '/pages/puzzle/bank'
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协谜题库'
    };
  }
});
