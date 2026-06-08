const activityService = require('../../services/activity.js');
const subscribe = require('../../utils/subscribe.js');
const { applyTheme } = require('../../utils/theme.js');

function toDate(value) {
  if (!value) return null;
  if (value.$date) return new Date(value.$date);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return '待定';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function statusText(status) {
  return ({
    registered: '已报名',
    confirmed: '已确认',
    pending: '待确认',
    attended: '已参加',
    cancelled: '已取消'
  })[status] || '已报名';
}

function isActiveRegistration(status) {
  return ['registered', 'confirmed', 'pending'].includes(status);
}

Page({
  data: {
    activities: [],
    visible_activities: [],
    my_activities: [],
    tab: 'all',
    theme: 'blue',
    loading: false,
    error: '',
    refreshing: false,
    selected_activity: null,
    show_register_modal: false,
    register_reason: '',
    registering: false,
    canceling_id: ''
  },

  onLoad() {
    this.loadTheme();
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    this.loadMyActivities();
    if (this.data.activities.length === 0) this.loadActivities();
  },

  loadTheme() {
    applyTheme(this);
  },

  async initPage() {
    await Promise.all([
      this.loadActivities(),
      this.loadMyActivities()
    ]);
  },

  mapActivity(item = {}) {
    const capacity = Number(item.capacity || 0);
    const registered_count = Number(item.registered_count || 0);
    const end_date = toDate(item.end_time);

    return {
      ...item,
      activity_id: item.activity_id || item._id || '',
      title: item.title || '未命名活动',
      location: item.location || '待定',
      start_text: formatDateTime(item.start_time),
      end_text: formatDateTime(item.end_time),
      deadline_text: formatDateTime(item.cancel_deadline),
      registered_count,
      capacity,
      remaining_capacity: item.remaining_capacity !== undefined
        ? Number(item.remaining_capacity)
        : Math.max(0, capacity - registered_count),
      is_full: capacity > 0 && registered_count >= capacity,
      is_expired: end_date ? end_date < new Date() : false
    };
  },

  async loadActivities(showLoading = true) {
    if (showLoading) this.setData({ loading: true, error: '' });
    try {
      const result = await activityService.getActivities({ page_size: 50 });
      if (!result.success) throw new Error(result.error || '加载活动失败');
      const list = (result.data || []).map(item => this.mapActivity(item));
      this.setData({
        activities: list,
        visible_activities: list.filter(item => !item.is_expired)
      });
    } catch (error) {
      this.setData({ error: error.message || '网络错误，请重试' });
      console.error('Load activities failed:', error);
    } finally {
      if (showLoading) this.setData({ loading: false });
    }
  },

  async loadMyActivities() {
    try {
      const result = await activityService.getMyActivities({ page_size: 50 });
      if (!result.success) return;

      const list = (result.data || []).map(item => {
        const activity = this.mapActivity(item.activity || {});
        const status = item.status || 'registered';
        const deadline_date = toDate(activity.cancel_deadline);
        const can_cancel = isActiveRegistration(status) && (!deadline_date || deadline_date > new Date());

        return {
          ...item,
          activity_id: item.activity_id || activity.activity_id,
          registration_id: item.registration_id || '',
          title: activity.title || '未命名活动',
          start_text: activity.start_text,
          end_text: activity.end_text,
          deadline_text: activity.deadline_text,
          location: activity.location,
          registration_time: formatDateTime(item.registered_at),
          reason: item.reason || '',
          status,
          status_text: statusText(status),
          can_cancel
        };
      });
      this.setData({ my_activities: list });
    } catch (error) {
      console.error('Load my activities failed:', error);
    }
  },

  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab });
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    Promise.all([
      this.loadActivities(false),
      this.loadMyActivities()
    ]).finally(() => {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    });
  },

  showRegisterModal(event) {
    const activity_id = event.currentTarget.dataset.id;
    const activity = this.data.activities.find(item => item.activity_id === activity_id);
    if (!activity) return;

    if (activity.remaining_capacity <= 0) {
      wx.showToast({ title: '活动已满员', icon: 'none' });
      return;
    }

    this.setData({
      selected_activity: activity,
      show_register_modal: true,
      register_reason: ''
    });
  },

  closeRegisterModal() {
    this.setData({ show_register_modal: false });
  },

  onReasonInput(event) {
    this.setData({ register_reason: event.detail.value });
  },

  noop() {},

  async submitRegister(can_not_cancel_confirm = false) {
    const { selected_activity, register_reason } = this.data;
    return activityService.registerActivity(selected_activity.activity_id, {
      reason: register_reason.trim(),
      can_not_cancel_confirm
    });
  },

  async confirmRegister() {
    if (!this.data.register_reason.trim()) {
      wx.showToast({ title: '请输入报名理由', icon: 'none' });
      return;
    }

    // 申请订阅授权（报名成功 + 活动开始提醒）；须在点击手势栈内触发，用户拒绝不影响报名
    await subscribe.requestSubscribe([
      subscribe.TEMPLATES.REGISTER_SUCCESS,
      subscribe.TEMPLATES.ACTIVITY_REMINDER
    ]);

    this.setData({ registering: true });
    try {
      const result = await this.submitRegister(false);
      if (!result.success && result.code === 'CANCEL_CONFIRM_REQUIRED') {
        wx.showModal({
          title: '确认报名',
          content: '当前已超过最晚取消时间，报名成功后将不能取消。是否继续报名？',
          confirmText: '继续报名',
          cancelText: '再想想',
          success: async (res) => {
            if (res.confirm) await this.confirmRegisterAfterDeadline();
          }
        });
        return;
      }
      await this.handleRegisterResult(result);
    } catch (error) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error('Register activity failed:', error);
    } finally {
      this.setData({ registering: false });
    }
  },

  async confirmRegisterAfterDeadline() {
    this.setData({ registering: true });
    try {
      const result = await this.submitRegister(true);
      await this.handleRegisterResult(result);
    } catch (error) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error('Register activity failed:', error);
    } finally {
      this.setData({ registering: false });
    }
  },

  async handleRegisterResult(result) {
    if (result.success) {
      wx.showToast({ title: '报名成功', icon: 'success' });
      this.setData({ show_register_modal: false });
      await Promise.all([this.loadActivities(false), this.loadMyActivities()]);
      return;
    }
    wx.showToast({ title: result.error || '报名失败', icon: 'none' });
  },

  showCancelConfirm(event) {
    const { id, title } = event.currentTarget.dataset;
    wx.showModal({
      title: '取消报名',
      content: `确定要取消「${title}」的报名吗？`,
      confirmText: '取消报名',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) this.cancelRegister(id);
      }
    });
  },

  async cancelRegister(activity_id) {
    this.setData({ canceling_id: activity_id });
    try {
      const result = await activityService.cancelRegister(activity_id);
      if (result.success) {
        wx.showToast({ title: '已取消报名', icon: 'success' });
        await Promise.all([this.loadActivities(false), this.loadMyActivities()]);
      } else {
        wx.showToast({ title: result.error || '取消失败', icon: 'none' });
      }
    } catch (error) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error('Cancel registration failed:', error);
    } finally {
      this.setData({ canceling_id: '' });
    }
  },

  onRetry() {
    this.initPage();
  },

  onShareAppMessage() {
    return {
      title: 'NK推协 · 活动报名',
      path: '/pages/activity/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 活动报名'
    };
  }
});
