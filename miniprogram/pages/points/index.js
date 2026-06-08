const pointsService = require('../../services/points.js');
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
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function typeText(type) {
  return ({
    income: '收入',
    expense: '支出',
    freeze: '冻结',
    unfreeze: '解冻',
    commission_freeze: '委托冻结',
    commission_reward: '委托奖励',
    daily_puzzle: '每日谜题',
    exchange_complete: '兑换完成',
    exchange_cancel: '兑换取消',
    admin_adjust: '后台调整'
  })[type] || type || '变动';
}

function normalizeLog(item) {
  const amount = Number(item.change_amount !== undefined ? item.change_amount : item.amount || 0);
  return {
    ...item,
    log_id: item.log_id || item._id || '',
    amount,
    display_amount: amount > 0 ? `+${amount}` : String(amount),
    is_income: amount > 0,
    type_text: typeText(item.business_type || item.type),
    reason: item.reason || '积分变动',
    created_text: formatTime(item.created_at)
  };
}

Page({
  data: {
    loading: true,
    refreshing: false,
    loading_more: false,
    error: '',
    theme: 'blue',
    points: {
      total_points: 0,
      available_points: 0,
      frozen_points: 0,
      used_points: 0
    },
    logs: [],
    page: 1,
    page_size: 20,
    has_more: false,
    filter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'income', label: '收入' },
      { key: 'expense', label: '支出' }
    ]
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
        this.loadPoints(),
        this.loadHistory(true)
      ]);
    } catch (error) {
      console.error('Init points page failed:', error);
      this.setData({ error: error.message || '加载失败' });
    } finally {
      this.setData({ loading: false, refreshing: false });
      wx.stopPullDownRefresh();
    }
  },

  async loadPoints() {
    const result = await pointsService.getUserPoints();
    if (!result.success) throw new Error('获取积分失败');
    this.setData({
      points: {
        total_points: Number(result.total_points || 0),
        available_points: Number(result.available_points || 0),
        frozen_points: Number(result.frozen_points || 0),
        used_points: Number(result.used_points || 0)
      }
    });
  },

  async loadHistory(reset = false) {
    if (this.data.loading_more && !reset) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading_more: !reset });

    const params = {
      page,
      page_size: this.data.page_size
    };
    if (this.data.filter !== 'all') params.type = this.data.filter;

    try {
      const result = await pointsService.getPointsHistory(params);
      if (!result.success) throw new Error(result.error || '获取流水失败');

      const list = (result.data || []).map(normalizeLog);
      this.setData({
        logs: reset ? list : this.data.logs.concat(list),
        page,
        has_more: Boolean(result.has_more),
        error: ''
      });
    } finally {
      this.setData({ loading_more: false });
    }
  },

  switchFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    if (filter === this.data.filter) return;
    this.setData({ filter, page: 1 });
    this.loadHistory(true).catch((error) => {
      console.error('Switch points filter failed:', error);
      this.setData({ error: error.message || '获取流水失败' });
    });
  },

  loadMore() {
    if (!this.data.has_more || this.data.loading_more) return;
    this.loadHistory(false);
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    await this.initPage();
  },

  onRetry() {
    this.initPage();
  }
});
