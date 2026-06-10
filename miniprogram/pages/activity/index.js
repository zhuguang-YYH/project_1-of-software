const activityService = require('../../services/activity.js');
const subscribe = require('../../utils/subscribe.js');
const { applyTheme } = require('../../utils/theme.js');
const share = require('../../utils/share.js');
const interaction = require('../../utils/interaction.js');

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
    waiting: '候补中',
    cancelled: '已取消'
  })[status] || '已报名';
}

function isActiveRegistration(status) {
  return ['registered', 'confirmed', 'pending', 'waiting'].includes(status);
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
    focus_activity_id: '',
    selected_activity: null,
    show_register_modal: false,
    register_reason: '',
    register_error: '',
    registering: false,
    canceling_id: '',
    pending_cancel_id: ''
  },

  onLoad(options = {}) {
    share.rememberInviter(options);
    this.loadTheme();
    this.setData({ focus_activity_id: options.activity_id || '' });
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

    const is_full = capacity > 0 && registered_count >= capacity;
    const remaining_capacity = item.remaining_capacity !== undefined
      ? Number(item.remaining_capacity)
      : Math.max(0, capacity - registered_count);
    const near_full = !is_full && capacity > 0 && remaining_capacity <= Math.max(2, Math.ceil(capacity * 0.2));
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
      waitlist_count: Number(item.waitlist_count || 0),
      remaining_capacity,
      is_full,
      is_nearly_full: near_full,
      status_label: is_full ? '已满员' : near_full ? '即将满员' : `余 ${remaining_capacity}`,
      is_expired: end_date ? end_date < new Date() : false,
      is_registered: !!item.is_registered,
      is_waitlisted: !!item.is_waitlisted,
      user_registration: item.user_registration || null
    };
  },

  mergeRegistrationState(activities = this.data.activities, myActivities = this.data.my_activities) {
    const registeredIds = new Set(
      (myActivities || [])
        .filter(item => isActiveRegistration(item.status))
        .map(item => item.activity_id)
        .filter(Boolean)
    );

    const merged = (activities || []).map(item => {
      const matched = (myActivities || []).find(my => my.activity_id === item.activity_id && my.status === 'waiting');
      const is_registered = !!item.is_registered || registeredIds.has(item.activity_id);
      return { ...item, is_registered, is_waitlisted: !!item.is_waitlisted || !!matched };
    });

    return {
      activities: merged,
      visible_activities: merged.filter(item => !item.is_expired)
    };
  },

  async loadActivities(showLoading = true) {
    if (showLoading) this.setData({ loading: true, error: '' });
    try {
      const result = await activityService.getActivities({ page_size: 50 });
      if (!result.success) throw new Error(result.error || '加载活动失败');
      let list = (result.data || []).map(item => this.mapActivity(item));
      const focusId = this.data.focus_activity_id;
      if (focusId && !list.some(item => item.activity_id === focusId)) {
        const detail = await activityService.getActivityDetail(focusId);
        if (detail.success && detail.data) list = [this.mapActivity(detail.data), ...list];
      }
      if (focusId) {
        list = list.slice().sort((a, b) => {
          if (a.activity_id === focusId) return -1;
          if (b.activity_id === focusId) return 1;
          return 0;
        });
      }
      this.setData(this.mergeRegistrationState(list, this.data.my_activities));
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
          can_cancel: status === 'waiting' || can_cancel
        };
      });
      this.setData({
        my_activities: list,
        ...this.mergeRegistrationState(this.data.activities, list)
      });
    } catch (error) {
      console.error('Load my activities failed:', error);
    }
  },

  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab });
  },

  onPullDownRefresh() {
    if (!interaction.canRefresh(this)) return;
    this.setData({ refreshing: true });
    Promise.all([
      this.loadActivities(false),
      this.loadMyActivities()
    ]).finally(() => {
      interaction.finishRefresh(this);
    });
  },

  showRegisterModal(event) {
    const activity_id = event.currentTarget.dataset.id;
    const activity = this.data.activities.find(item => item.activity_id === activity_id);
    if (!activity) return;

    if (activity.is_registered) {
      wx.showToast({ title: '您已报名此活动', icon: 'none' });
      return;
    }

    if (activity.is_waitlisted) {
      wx.showToast({ title: '您已在候补名单中', icon: 'none' });
      return;
    }

    this.setData({
      selected_activity: activity,
      show_register_modal: true,
      register_reason: '',
      register_error: ''
    });
  },

  closeRegisterModal() {
    this.setData({ show_register_modal: false });
  },

  onReasonInput(event) {
    const register_reason = event.detail.value;
    this.setData({
      register_reason,
      register_error: register_reason.trim() ? '' : '请输入报名理由'
    });
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
      this.setData({ register_error: '请输入报名理由' });
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
        this.selectComponent('#deadlineConfirm').show({
          title: '确认报名',
          content: '当前已超过最晚取消时间，报名成功后将不能取消。是否继续报名？',
          confirmText: '继续报名',
          cancelText: '再想想'
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
      wx.showToast({
        title: result.waitlisted ? (result.idempotent ? '已在候补中' : '已加入候补') : (result.idempotent ? '您已报名过此活动' : '报名成功'),
        icon: result.idempotent ? 'none' : 'success'
      });
      this.setData({ show_register_modal: false });
      await Promise.all([this.loadActivities(false), this.loadMyActivities()]);
      return;
    }
    wx.showToast({ title: result.error || '报名失败', icon: 'none' });
  },

  showCancelConfirm(event) {
    const { id, title } = event.currentTarget.dataset;
    this.setData({ pending_cancel_id: id });
    this.selectComponent('#cancelConfirm').show({
      title: '取消报名',
      content: `确定要取消「${title}」的报名吗？`,
      confirmText: '取消报名',
      cancelText: '再想想'
    });
  },

  confirmCancelRegister() {
    if (this.data.pending_cancel_id) this.cancelRegister(this.data.pending_cancel_id);
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

  onShareAppMessage(options = {}) {
    const dataset = options.target && options.target.dataset ? options.target.dataset : {};
    const activityId = dataset.id || this.data.focus_activity_id || '';
    const activity = this.data.activities.find(item => item.activity_id === activityId) || null;
    return {
      title: activity ? `NK推协活动 · ${activity.title}` : 'NK推协 · 活动报名',
      path: share.appendShareParams('/pages/activity/index', activityId ? { activity_id: activityId } : {}),
      imageUrl: activity && (activity.cover_url || activity.image) ? (activity.cover_url || activity.image) : ''
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 活动报名',
      query: share.appendShareParams('', this.data.focus_activity_id ? { activity_id: this.data.focus_activity_id } : {}).replace(/^\?/, '')
    };
  }
});
