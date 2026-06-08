const recommendationService = require('../../services/recommendation.js');
const { applyTheme } = require('../../utils/theme.js');

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.$date) return new Date(value.$date);
  return new Date(value);
}

function formatTime(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function categoryText(category) {
  return ({
    all: '全部',
    book: '书籍',
    game: '游戏',
    script: '剧本杀',
    activity: '活动',
    article: '文章',
    general: '推荐'
  })[category] || category || '推荐';
}

function normalizeItem(item) {
  const category = item.category || 'general';
  const article_url = item.article_url || item.link_url || '';

  return {
    ...item,
    recommendation_id: item.recommendation_id || item._id || '',
    title: item.title || '推荐内容',
    category,
    category_text: categoryText(category),
    recommender_id: item.recommender_id || '',
    recommender_name: item.recommender_name || 'NK推协',
    reason: item.reason || '暂无推荐理由',
    cover_url: item.cover_url || '',
    link_url: item.link_url || article_url,
    article_url,
    created_text: formatTime(item.published_at || item.created_at)
  };
}

Page({
  data: {
    loading: true,
    refreshing: false,
    loading_more: false,
    error: '',
    theme: 'blue',
    list: [],
    page: 1,
    page_size: 10,
    has_more: false,
    keyword: '',
    active_category: 'all',
    selected: null,
    show_detail: false,
    categories: [
      { key: 'all', label: '全部' },
      { key: 'book', label: '书籍' },
      { key: 'game', label: '游戏' },
      { key: 'script', label: '剧本杀' },
      { key: 'activity', label: '活动' }
    ]
  },

  onLoad(options) {
    this.loadTheme();
    this._highlightId = options && options.highlight ? options.highlight : null;
    this.loadRecommendations(true);
  },

  onShow() {
    this.loadTheme();
  },

  loadTheme() {
    applyTheme(this);
  },

  async loadRecommendations(reset = false) {
    if (this.data.loading_more && !reset) return;

    const next_page = reset ? 1 : this.data.page + 1;
    this.setData({
      loading: reset,
      loading_more: !reset,
      error: reset ? '' : this.data.error
    });

    try {
      const result = await recommendationService.getRecommendations({
        page: next_page,
        page_size: this.data.page_size,
        category: this.data.active_category,
        keyword: this.data.keyword.trim()
      });

      if (!result.success) throw new Error(result.error || '获取推荐失败');

      const items = (result.data || []).map(normalizeItem);
      const list = reset ? items : this.data.list.concat(items);

      this.setData({
        list,
        page: next_page,
        has_more: Boolean(result.has_more),
        error: ''
      });

      if (reset && this._highlightId) {
        const target = list.find(item => item.recommendation_id === this._highlightId);
        if (target) {
          this.setData({ selected: target, show_detail: true });
        }
        this._highlightId = null;
      }
    } catch (error) {
      console.error('Load recommendations failed:', error);
      this.setData({ error: error.message || '加载失败，请稍后重试' });
    } finally {
      this.setData({
        loading: false,
        loading_more: false,
        refreshing: false
      });
      wx.stopPullDownRefresh();
    }
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onSearchConfirm() {
    this.loadRecommendations(true);
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.loadRecommendations(true);
  },

  switchCategory(event) {
    const category = event.currentTarget.dataset.category;
    if (category === this.data.active_category) return;
    this.setData({ active_category: category, page: 1 });
    this.loadRecommendations(true);
  },

  async openDetail(event) {
    const recommendation_id = event.currentTarget.dataset.id;
    const cached = this.data.list.find(item => item.recommendation_id === recommendation_id);
    this.setData({
      selected: cached || null,
      show_detail: true
    });

    if (!recommendation_id) return;

    try {
      const result = await recommendationService.getDetail(recommendation_id);
      if (result.success && result.data) {
        this.setData({ selected: normalizeItem(result.data) });
      }
    } catch (error) {
      console.error('Load recommendation detail failed:', error);
    }
  },

  closeDetail() {
    this.setData({ show_detail: false, selected: null });
  },

  noop() {},

  openLink() {
    const selected = this.data.selected;
    if (!selected || !selected.link_url) return;

    wx.setClipboardData({
      data: selected.link_url,
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' });
      }
    });
  },

  loadMore() {
    if (!this.data.has_more || this.data.loading_more) return;
    this.loadRecommendations(false);
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    await this.loadRecommendations(true);
  },

  onRetry() {
    this.loadRecommendations(true);
  },

  onShareAppMessage() {
    return {
      title: 'NK推协 · 好物推荐',
      path: '/pages/recommendation/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 好物推荐'
    };
  }
});
