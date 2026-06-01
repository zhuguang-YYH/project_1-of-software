const { request } = require('../../utils/request');

Page({
  data: {
    puzzle: null,
    options: [],
    selected_option_id: '',
    answered: false,
    is_correct: false,
    loading: true,
    submitting: false,
    error: ''
  },

  onLoad() {
    this.loadPuzzle();
  },

  async loadPuzzle() {
    try {
      this.setData({ loading: true, error: '' });

      const result = await request.callCloudFunction('puzzle_getTodayPuzzle', {});
      if (!result.success) throw new Error(result.message || '加载谜题失败');

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

      this.setData({
        puzzle,
        options,
        answered: !!puzzle.answered,
        is_correct: !!puzzle.is_correct,
        selected_option_id: puzzle.selected_option_id || '',
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

      const result = await request.callCloudFunction('puzzle_submitAnswer', {
        puzzle_id: this.data.puzzle.puzzle_id,
        option_id: this.data.selected_option_id
      });
      if (!result.success) throw new Error(result.message || '提交失败');

      const data = result.data || {};
      this.setData({
        answered: true,
        is_correct: !!data.is_correct,
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
      console.error('Submit answer failed:', error);
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  onRetry() {
    this.loadPuzzle();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onShareAppMessage() {
    return {
      title: '每日谜题挑战',
      path: '/pages/puzzle/index'
    };
  }
});
