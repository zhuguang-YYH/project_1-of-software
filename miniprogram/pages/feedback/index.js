const feedbackService = require('../../services/feedback.js');
const format = require('../../utils/format.js');
const { applyTheme } = require('../../utils/theme.js');

function formatTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value.$date || value);
  if (Number.isNaN(date.getTime())) return '';
  return format.formatDate(date, 'YYYY-MM-DD HH:mm');
}

function feedbackTypeText(feedback_type) {
  const map = {
    general: '一般反馈',
    bug: '问题反馈',
    activity: '活动建议',
    feature: '功能建议',
    content: '内容建议'
  };
  return map[feedback_type] || feedback_type || '一般反馈';
}

function feedbackStatusText(status) {
  const map = {
    pending: '待处理',
    processing: '处理中',
    resolved: '已处理',
    closed: '已关闭'
  };
  return map[status] || status || '待处理';
}

function normalizeFeedback(item = {}) {
  const feedback_id = item.feedback_id || item._id || '';
  const feedback_type = item.feedback_type || 'general';
  const admin_remark = item.admin_remark || '';

  return {
    ...item,
    feedback_id,
    feedback_type,
    admin_remark,
    feedback_type_text: feedbackTypeText(feedback_type),
    status_text: feedbackStatusText(item.status),
    created_text: formatTime(item.created_at),
    is_resolved: item.status === 'resolved',
    anonymous_text: item.is_anonymous ? ' · 匿名' : ''
  };
}

Page({
  data: {
    tab: 'submit',
    loading: true,
    submitting: false,
    refreshing: false,
    error: '',
    theme: 'blue',
    feedback_list: [],
    type_options: [
      { key: 'general', label: '一般反馈' },
      { key: 'bug', label: '问题反馈' },
      { key: 'activity', label: '活动建议' },
      { key: 'feature', label: '功能建议' },
      { key: 'content', label: '内容建议' }
    ],
    form: {
      content: '',
      feedback_type: 'general',
      is_anonymous: false
    }
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
      await this.loadMyFeedback();
    } catch (err) {
      console.error('Feedback init failed:', err);
      this.setData({ error: err.message || '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMyFeedback() {
    const result = await feedbackService.getMyFeedback({
      page: 1,
      page_size: 50
    });
    if (!result.success) throw new Error(result.error || 'Load feedback failed');

    const list = result.data || [];
    this.setData({ feedback_list: list.map(normalizeFeedback) });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  chooseType(e) {
    this.setData({
      form: {
        ...this.data.form,
        feedback_type: e.currentTarget.dataset.feedback_type
      }
    });
  },

  onInput(e) {
    this.setData({
      form: {
        ...this.data.form,
        content: e.detail.value
      }
    });
  },

  onAnonymousChange(e) {
    this.setData({
      form: {
        ...this.data.form,
        is_anonymous: e.detail.value
      }
    });
  },

  async submitFeedback() {
    const { form } = this.data;
    const content = form.content.trim();

    if (content.length < 5) {
      wx.showToast({ title: 'At least 5 chars', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const result = await feedbackService.submit({
        content,
        feedback_type: form.feedback_type,
        is_anonymous: form.is_anonymous
      });
      if (!result.success) throw new Error(result.error || 'Submit failed');

      wx.showToast({ title: 'Submitted', icon: 'success' });
      this.setData({
        tab: 'mine',
        form: {
          content: '',
          feedback_type: 'general',
          is_anonymous: false
        }
      });
      await this.loadMyFeedback();
    } catch (err) {
      wx.showToast({ title: err.message || 'Submit failed', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.loadMyFeedback();
    } catch (err) {
      console.error('Refresh feedback failed:', err);
    } finally {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    }
  },

  onRetry() {
    this.initPage();
  }
});
