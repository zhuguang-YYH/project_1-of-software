const puzzleService = require('../../services/puzzle.js');
const { applyTheme } = require('../../utils/theme.js');
const interaction = require('../../utils/interaction.js');

const CATEGORY_CLASS_MAP = {
  '逻辑推理': 'logic',
  '密码解密': 'crypto',
  '字谜': 'riddle',
  '数学': 'math',
  '观察力': 'observe',
  '其他': 'other',
  '未分类': 'other'
};

function normalizePuzzleCard(item = {}) {
  const category = item.category || '未分类';
  const title = item.title || item.content || '未命名谜题';

  return {
    ...item,
    display_title: title,
    display_category: category,
    category_class: CATEGORY_CLASS_MAP[category] || 'other',
    attempt_count: Number(item.attempt_count || 0),
    correct_rate: Number(item.correct_rate || 0),
    reward_points: Number(item.reward_points || 0),
    _difficulty_class: item._difficulty_class || 'normal',
    _difficulty_text: item._difficulty_text || '中等'
  };
}

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
    if (!this.data.loading) {
      this.loadPuzzles(true);
    }
  },

  loadTheme() {
    applyTheme(this);
  },

  async refreshFavoriteStatus() {
    const { puzzles } = this.data;
    if (!puzzles || puzzles.length === 0) return;
    try {
      const result = await puzzleService.getFavoriteIds();
      if (result.success && result.data && result.data.ids) {
        const favSet = new Set(result.data.ids);
        const updated = puzzles.map(p => ({
          ...p,
          is_favorited: favSet.has(p.puzzle_id)
        }));
        this.setData({ puzzles: updated });
      }
    } catch (_) { /* ignore */ }
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
      const incoming = (data.list || []).map(normalizePuzzleCard);
      const newList = reset ? incoming : [...this.data.puzzles, ...incoming];

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

  resetFilters() {
    this.setData({
      activeCategory: '',
      activeDifficulty: '',
      searchKeyword: '',
      sortBy: 'date',
      sortOrder: 'desc'
    }, () => {
      this.loadPuzzles(true);
    });
  },

  async toggleFavorite(e) {
    const puzzle_id = e.currentTarget.dataset.puzzleId;
    if (!puzzle_id) return;

    const oldList = this.data.puzzles;
    const target = oldList.find(item => item.puzzle_id === puzzle_id);
    const nextFavorited = !(target && target.is_favorited);
    const nextList = oldList.map(item => (
      item.puzzle_id === puzzle_id ? { ...item, is_favorited: nextFavorited } : item
    ));
    this.setData({ puzzles: nextList });

    try {
      const result = await puzzleService.toggleFavorite(puzzle_id);
      if (!result.success) throw new Error(result.error || '收藏操作失败');
      wx.showToast({
        title: nextFavorited ? '已收藏' : '已取消收藏',
        icon: 'none'
      });
    } catch (err) {
      this.setData({ puzzles: oldList });
      wx.showToast({ title: err.message || '收藏操作失败', icon: 'none' });
    }
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
