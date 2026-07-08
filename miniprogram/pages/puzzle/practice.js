const puzzleService = require('../../services/puzzle.js');
const { applyTheme } = require('../../utils/theme.js');

Page({
  data: {
    puzzle: null,
    options: [],
    selected_option_id: '',
    answered: false,
    is_correct: false,
    is_favorited: false,
    already_answered: false,
    loading: true,
    submitting: false,
    theme: 'blue',
    error: ''
  },

  onLoad(options = {}) {
    this.loadTheme();
    const puzzle_id = options.puzzle_id || '';
    if (puzzle_id) {
      this.setData({ puzzle_id });
      this.loadPuzzle();
    } else {
      this.setData({
        error: '缺少谜题编号',
        loading: false
      });
    }
  },

  onShow() {
    this.loadTheme();
  },

  loadTheme() {
    applyTheme(this);
  },

  async loadPuzzle() {
    if (!this.data.puzzle_id) return;

    try {
      this.setData({ loading: true, error: '' });

      const result = await puzzleService.getPuzzleDetail(this.data.puzzle_id);
      if (!result.success) throw new Error(result.error || '加载谜题失败');

      const puzzle = result.data || {};
      const DIFFICULTY_MAP = { easy: '简单', normal: '中等', medium: '中等', hard: '困难', extreme: '极限' };
      const VALID_CLASSES = ['easy', 'normal', 'medium', 'hard', 'extreme'];
      const raw = String(puzzle.difficulty || '').toLowerCase();
      puzzle._difficulty_class = VALID_CLASSES.includes(raw) ? raw : 'normal';
      puzzle._difficulty_text = DIFFICULTY_MAP[raw] || (puzzle.difficulty || '中等');

      const options = (puzzle.options || []).map((option, index) => ({
        option_id: option.option_id || option.option_content,
        option_label: option.option_label || String.fromCharCode(65 + index),
        option_content: option.option_content || ''
      }));

      // 检查收藏状态
      let is_favorited = false;
      try {
        const favResult = await puzzleService.getFavoriteIds();
        if (favResult.success && favResult.data && favResult.data.ids) {
          is_favorited = favResult.data.ids.includes(this.data.puzzle_id);
        }
      } catch (_) { /* ignore */ }

      this.setData({
        puzzle,
        options,
        is_favorited,
        loading: false
      });
    } catch (error) {
      console.error('Load puzzle failed:', error);
      this.setData({
        error: error.message || '加载谜题失败',
        loading: false
      });
    }
  },

  selectOption(event) {
    const option_id = event.currentTarget.dataset.optionId;
    this.setData({ selected_option_id: option_id });
  },

  async submitAnswer() {
    if (!this.data.selected_option_id) {
      wx.showToast({ title: '请选择答案', icon: 'none' });
      return;
    }

    try {
      this.setData({ submitting: true });

      const result = await puzzleService.submitPracticeAnswer(
        this.data.puzzle_id,
        this.data.selected_option_id
      );
      if (!result.success) throw new Error(result.error || '提交失败');

      const data = result.data || {};
      this.setData({
        answered: true,
        is_correct: !!data.is_correct,
        already_answered: !!data.already_answered,
        puzzle: {
          ...this.data.puzzle,
          correct_answer: data.correct_answer || '',
          answer_explanation: data.answer_explanation || this.data.puzzle.answer_explanation || ''
        },
        submitting: false
      });

      wx.showToast({
        title: data.is_correct ? '答对了' : '回答错误',
        icon: data.is_correct ? 'success' : 'none',
        duration: 2000
      });
    } catch (error) {
      console.error('Submit practice answer failed:', error);
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  async toggleFavorite() {
    try {
      const result = await puzzleService.toggleFavorite(this.data.puzzle_id);
      if (result.success) {
        const data = result.data || {};
        this.setData({ is_favorited: !!data.is_favorited });
        wx.showToast({
          title: data.is_favorited ? '已收藏' : '已取消收藏',
          icon: 'success',
          duration: 1500
        });
      }
    } catch (error) {
      console.error('Toggle favorite failed:', error);
      wx.showToast({ title: '操作收藏失败', icon: 'none' });
    }
  },

  onRetry() {
    this.loadPuzzle();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  goToBank() {
    wx.navigateTo({ url: '/pages/puzzle/bank' });
  },

  onShareAppMessage() {
    return {
      title: '谜题练习',
      path: `/pages/puzzle/practice?puzzle_id=${this.data.puzzle_id}`
    };
  },

  onShareTimeline() {
    return {
      title: '谜题练习',
      query: `puzzle_id=${this.data.puzzle_id}`
    };
  }
});
