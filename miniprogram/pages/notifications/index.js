const { callFunction } = require('../../utils/request.js');
const { applyTheme } = require('../../utils/theme.js');

function formatTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value.$date || value);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + '天前';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d}`;
}

const TYPE_ICONS = {
  activity: '📅',
  exchange: '🎁',
  borrow: '📚',
  commission: '📋',
  system: '📢',
  puzzle: '🧩',
  points: '⭐'
};

const TYPE_LABELS = {
  activity: '活动通知',
  exchange: '兑换通知',
  borrow: '借阅通知',
  commission: '委托通知',
  system: '系统公告',
  puzzle: '谜题提醒',
  points: '积分变动'
};

function normalizeNotification(item = {}) {
  return {
    id: item.notification_id || item._id || '',
    type: item.type || 'system',
    title: item.title || TYPE_LABELS[item.type] || '系统通知',
    content: item.content || '',
    is_read: !!item.is_read,
    link_url: item.link_url || '',
    created_at: item.created_at || '',
    created_text: formatTime(item.created_at),
    type_icon: TYPE_ICONS[item.type] || '📌'
  };
}

Page({
  data: {
    loading: true,
    refreshing: false,
    error: '',
    theme: 'blue',
    notification_list: [],
    unread_count: 0
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
      await this.loadNotifications();
    } catch (err) {
      console.error('Failed to load notifications:', err);
      this.setData({ error: err.message || '加载消息失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadNotifications() {
    try {
      const result = await callFunction('notification_getList', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || '加载消息失败');
      const data = result.data || {};
      const list = (data.list || []).map(normalizeNotification);
      const unread_count = (data.unread_count || list.filter(item => !item.is_read).length);
      this.setData({ notification_list: list, unread_count });
    } catch (err) {
      if (err.message && err.message.includes('not exist')) {
        this.setData({ notification_list: [] });
        return;
      }
      throw err;
    }
  },

  async markAsRead(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    try {
      await callFunction('notification_markRead', { notification_id: id });
      const list = this.data.notification_list.map(item => {
        if (item.id === id) return { ...item, is_read: true };
        return item;
      });
      this.setData({ notification_list: list, unread_count: Math.max(0, this.data.unread_count - 1) });
    } catch (_) { /* ignore */ }
  },

  async markAllRead() {
    if (this.data.unread_count === 0) {
      wx.showToast({ title: '没有未读消息', icon: 'none' });
      return;
    }
    try {
      await callFunction('notification_markAllRead', {});
      const list = this.data.notification_list.map(item => ({ ...item, is_read: true }));
      this.setData({ notification_list: list, unread_count: 0 });
      wx.showToast({ title: '已全部标为已读', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  onNotificationTap(e) {
    const { id, url } = e.currentTarget.dataset;
    if (id) this.markAsRead(e);
    if (url) {
      wx.navigateTo({ url, fail: () => {} });
    }
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.loadNotifications();
    } finally {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    }
  },

  onRetry() {
    this.initPage();
  }
});
