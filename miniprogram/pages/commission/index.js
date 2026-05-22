const { request } = require('../../utils/request.js');
const format = require('../../utils/format.js');

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = toDate(value);
  return date ? format.formatDate(date, 'YYYY-MM-DD HH:mm') : '';
}

function statusText(status) {
  const map = {
    recruiting: 'Recruiting',
    in_progress: 'In progress',
    resolved: 'Resolved',
    closed: 'Closed',
    accepted: 'Accepted',
    completed: 'Completed',
    rewarded: 'Rewarded',
    withdrawn: 'Withdrawn'
  };
  return map[status] || status || 'Unknown';
}

function normalizeCommission(item = {}) {
  const commission_id = item.commission_id || item._id || item.id || '';
  const deadline_date = toDate(item.deadline);
  const expired = deadline_date && Date.now() > deadline_date.getTime();
  const my_acceptance = item.my_acceptance || null;
  const reward_points = Number(item.reward_points || 0);
  const remaining_reward = item.remaining_reward !== undefined
    ? Number(item.remaining_reward)
    : reward_points;

  return {
    ...item,
    commission_id,
    description: item.content || item.description || '',
    reward_points,
    remaining_reward,
    publisher_name: item.publisher_name || 'Anonymous',
    created_text: formatTime(item.created_at),
    deadline_text: item.deadline ? formatTime(item.deadline) : 'Long term',
    status_text: statusText(item.status),
    can_accept: !expired && !item.is_mine && !my_acceptance && ['recruiting', 'in_progress'].includes(item.status),
    is_expired: expired,
    accepted_by_me: !!my_acceptance,
    my_acceptance_status_text: expired ? 'Expired' : (my_acceptance ? statusText(my_acceptance.status) : '')
  };
}

function normalizeAcceptance(item = {}) {
  const acceptance_id = item.acceptance_id || item._id || item.id || '';
  const commission = normalizeCommission(item.commission || {});

  return {
    ...item,
    acceptance_id,
    commission,
    title: item.title || commission.title || 'Untitled commission',
    reward_points: Number(commission.reward_points || item.reward_points || 0),
    remaining_reward: Number(commission.remaining_reward || 0),
    publisher_name: commission.publisher_name || 'Publisher',
    accepted_text: formatTime(item.accepted_at),
    completed_text: formatTime(item.completed_at),
    status_text: statusText(item.status),
    can_complete: item.status === 'accepted'
  };
}

function normalizePublished(item = {}) {
  const commission = normalizeCommission(item);
  const acceptances = (item.acceptances || []).map(acc => ({
    ...acc,
    acceptance_id: acc.acceptance_id || acc._id || acc.id || '',
    receiver_name: acc.receiver_name || 'Anonymous',
    status_text: statusText(acc.status),
    accepted_text: formatTime(acc.accepted_at),
    completed_text: formatTime(acc.completed_at),
    can_reward: acc.status === 'completed' && Number(commission.remaining_reward || 0) > 0
  }));

  return {
    ...commission,
    acceptances,
    has_acceptances: acceptances.length > 0
  };
}

Page({
  data: {
    tab: 'available',
    loading: true,
    refreshing: false,
    error: '',
    commissions: [],
    published: [],
    accepted: [],
    user_points: {
      available_points: 0,
      frozen_points: 0,
      total_points: 0
    },
    show_publish_modal: false,
    publishing: false,
    publish_form: {
      title: '',
      description: '',
      reward_points: '',
      deadline: ''
    },
    accepting_id: '',
    completing_id: '',
    show_reward_modal: false,
    rewarding: false,
    reward_target: null,
    reward_points_input: ''
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.refreshCurrentTab();
  },

  async initPage() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadUserPoints(),
        this.loadCommissions(),
        this.loadMyCommissions()
      ]);
    } catch (err) {
      console.error('Init commission failed:', err);
      this.setData({ error: err.message || 'Load failed' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async refreshCurrentTab() {
    if (this.data.loading) return;
    if (this.data.tab === 'available') {
      await this.loadCommissions();
      return;
    }
    await Promise.all([this.loadUserPoints(), this.loadMyCommissions()]);
  },

  async loadUserPoints() {
    try {
      const result = await request.callCloudFunction('points_getUserPoints', {});
      if (!result.success) return;
      const data = result.data || {};
      this.setData({
        user_points: {
          available_points: Number(data.available_points || 0),
          frozen_points: Number(data.frozen_points || 0),
          total_points: Number(data.total_points || 0)
        }
      });
    } catch (err) {
      console.error('Load points failed:', err);
    }
  },

  async loadCommissions() {
    try {
      const result = await request.callCloudFunction('commission_getCommissions', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || 'Load commissions failed');

      const list = ((result.data && result.data.list) || []).map(normalizeCommission);
      this.setData({ commissions: list, error: '' });
    } catch (err) {
      console.error('Load commissions failed:', err);
      this.setData({ error: err.message || 'Network error' });
    }
  },

  async loadMyCommissions() {
    try {
      const result = await request.callCloudFunction('commission_getMyCommissions', {
        page: 1,
        page_size: 50
      });
      if (!result.success) return;

      const data = result.data || {};
      this.setData({
        published: (data.published || []).map(normalizePublished),
        accepted: (data.accepted || []).map(normalizeAcceptance)
      });
    } catch (err) {
      console.error('Load my commissions failed:', err);
    }
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.refreshCurrentTab();
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.initPage();
    } finally {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    }
  },

  openPublishModal() {
    this.setData({
      show_publish_modal: true,
      publish_form: {
        title: '',
        description: '',
        reward_points: '',
        deadline: ''
      }
    });
  },

  closePublishModal() {
    if (this.data.publishing) return;
    this.setData({ show_publish_modal: false });
  },

  onPublishInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      publish_form: {
        ...this.data.publish_form,
        [field]: e.detail.value
      }
    });
  },

  async publishCommission() {
    const form = this.data.publish_form;
    const reward_points = Number(form.reward_points);

    if (!form.title.trim()) {
      wx.showToast({ title: 'Title required', icon: 'none' });
      return;
    }
    if (!form.description.trim()) {
      wx.showToast({ title: 'Content required', icon: 'none' });
      return;
    }
    if (!Number.isInteger(reward_points) || reward_points <= 0) {
      wx.showToast({ title: 'Invalid reward', icon: 'none' });
      return;
    }
    if (reward_points > this.data.user_points.available_points) {
      wx.showToast({ title: 'Points not enough', icon: 'none' });
      return;
    }

    this.setData({ publishing: true });
    try {
      const result = await request.callCloudFunction('commission_publishCommission', {
        title: form.title.trim(),
        content: form.description.trim(),
        reward_points,
        deadline: form.deadline.trim()
      });
      if (!result.success) throw new Error(result.message || 'Publish failed');

      wx.showToast({ title: 'Published', icon: 'success' });
      this.setData({ show_publish_modal: false, tab: 'published' });
      await Promise.all([this.loadUserPoints(), this.loadCommissions(), this.loadMyCommissions()]);
    } catch (err) {
      wx.showToast({ title: err.message || 'Publish failed', icon: 'none' });
    } finally {
      this.setData({ publishing: false });
    }
  },

  async acceptCommission(e) {
    const commission_id = e.currentTarget.dataset.commission_id;
    this.setData({ accepting_id: commission_id });
    try {
      const result = await request.callCloudFunction('commission_acceptCommission', { commission_id });
      if (!result.success) throw new Error(result.message || 'Accept failed');

      wx.showToast({ title: 'Accepted', icon: 'success' });
      await Promise.all([this.loadCommissions(), this.loadMyCommissions()]);
    } catch (err) {
      wx.showToast({ title: err.message || 'Accept failed', icon: 'none' });
    } finally {
      this.setData({ accepting_id: '' });
    }
  },

  async completeCommission(e) {
    const acceptance_id = e.currentTarget.dataset.acceptance_id;
    this.setData({ completing_id: acceptance_id });
    try {
      const result = await request.callCloudFunction('commission_completeCommission', { acceptance_id });
      if (!result.success) throw new Error(result.message || 'Submit failed');

      wx.showToast({ title: 'Submitted', icon: 'success' });
      await this.loadMyCommissions();
    } catch (err) {
      wx.showToast({ title: err.message || 'Submit failed', icon: 'none' });
    } finally {
      this.setData({ completing_id: '' });
    }
  },

  openRewardModal(e) {
    const { commission_id, acceptance_id, receiver_name, max } = e.currentTarget.dataset;
    this.setData({
      show_reward_modal: true,
      reward_target: {
        commission_id,
        acceptance_id,
        receiver_name,
        max: Number(max || 0)
      },
      reward_points_input: String(max || '')
    });
  },

  closeRewardModal() {
    if (this.data.rewarding) return;
    this.setData({ show_reward_modal: false, reward_target: null, reward_points_input: '' });
  },

  onRewardInput(e) {
    this.setData({ reward_points_input: e.detail.value });
  },

  async allocateReward() {
    const target = this.data.reward_target;
    const allocated_points = Number(this.data.reward_points_input);

    if (!target) return;
    if (!Number.isInteger(allocated_points) || allocated_points <= 0) {
      wx.showToast({ title: 'Invalid points', icon: 'none' });
      return;
    }
    if (allocated_points > target.max) {
      wx.showToast({ title: 'Too many points', icon: 'none' });
      return;
    }

    this.setData({ rewarding: true });
    try {
      const result = await request.callCloudFunction('commission_allocateRewards', {
        commission_id: target.commission_id,
        acceptance_id: target.acceptance_id,
        allocated_points
      });
      if (!result.success) throw new Error(result.message || 'Reward failed');

      wx.showToast({ title: 'Rewarded', icon: 'success' });
      this.setData({ show_reward_modal: false, reward_target: null, reward_points_input: '' });
      await Promise.all([this.loadUserPoints(), this.loadCommissions(), this.loadMyCommissions()]);
    } catch (err) {
      wx.showToast({ title: err.message || 'Reward failed', icon: 'none' });
    } finally {
      this.setData({ rewarding: false });
    }
  },

  onRetry() {
    this.initPage();
  },

  onShareAppMessage() {
    return {
      title: 'Commission',
      path: '/pages/commission/index'
    };
  },

  noop() {}
});
