const commissionService = require('../../services/commission.js');
const format = require('../../utils/format.js');
const { applyTheme } = require('../../utils/theme.js');
const share = require('../../utils/share.js');

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = toDate(value);
  return date ? format.formatDate(date, 'YYYY-MM-DD HH:mm') : '';
}

function formatDeadlineParts(value) {
  const date = toDate(value);
  return date ? {
    deadline_date_text: format.formatDate(date, 'YYYY-MM-DD'),
    deadline_time_text: format.formatDate(date, 'HH:mm')
  } : {
    deadline_date_text: '长期',
    deadline_time_text: '有效'
  };
}

function statusText(status) {
  const map = {
    recruiting: '招募中',
    in_progress: '进行中',
    resolved: '已结案',
    closed: '已关闭',
    accepted: '已领取',
    completed: '已完成',
    rewarded: '已发放',
    withdrawn: '已撤销'
  };
  return map[status] || status || '未知';
}

function normalizeCommission(item = {}) {
  const commission_id = item.commission_id || item._id || item.id || '';
  const reward_points = Number(item.reward_points || 0);
  const remaining_reward = item.remaining_reward !== undefined
    ? Number(item.remaining_reward)
    : reward_points;

  return {
    ...item,
    commission_id,
    title: item.title || '未命名委托',
    description: item.content || item.description || '',
    publisher_name: item.publisher_name || '匿名侦探',
    reward_points,
    remaining_reward,
    accepted_count: Number(item.accepted_count || 0),
    completed_count: Number(item.completed_count || 0),
    created_text: formatTime(item.created_at),
    deadline_text: item.deadline ? formatTime(item.deadline) : '长期有效',
    ...formatDeadlineParts(item.deadline),
    status_text: statusText(item.status)
  };
}

function normalizeAcceptance(item = {}) {
  return {
    ...item,
    acceptance_id: item.acceptance_id || item._id || item.id || '',
    receiver_name: item.receiver_name || '匿名侦探',
    status_text: statusText(item.status),
    accepted_text: formatTime(item.accepted_at),
    completed_text: formatTime(item.completed_at)
  };
}

Page({
  data: {
    theme: 'blue',
    commission_id: '',
    commission: null,
    acceptances: [],
    loading: true,
    error: ''
  },

  onLoad(options = {}) {
    share.rememberInviter(options);
    this.loadTheme();
    const commission_id = options.commission_id || '';
    this.setData({ commission_id });
    this.loadDetail();
  },

  onShow() {
    this.loadTheme();
  },

  loadTheme() {
    applyTheme(this);
  },

  async loadDetail() {
    const { commission_id } = this.data;
    if (!commission_id) {
      this.setData({ loading: false, error: '委托编号不能为空' });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const result = await commissionService.getCommissionDetail(commission_id);
      if (!result.success) throw new Error(result.error || '获取委托详情失败');
      const data = result.data || {};
      this.setData({
        commission: normalizeCommission(data.commission || {}),
        acceptances: (data.acceptances || []).map(normalizeAcceptance),
        error: ''
      });
    } catch (error) {
      console.error('Load commission detail failed:', error);
      this.setData({ error: error.message || '网络异常' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onRetry() {
    this.loadDetail();
  },

  onShareAppMessage() {
    const { commission, commission_id } = this.data;
    return {
      title: commission ? `委托 · ${commission.title}` : '事件委托',
      path: share.appendShareParams('/pages/commission/detail', { commission_id })
    };
  }
});
