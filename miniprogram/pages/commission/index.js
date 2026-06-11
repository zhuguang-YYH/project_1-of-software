const commissionService = require('../../services/commission.js');
const pointsService = require('../../services/points.js');
const format = require('../../utils/format.js');
const subscribe = require('../../utils/subscribe.js');
const { applyTheme } = require('../../utils/theme.js');
const share = require('../../utils/share.js');
const interaction = require('../../utils/interaction.js');

const DESCRIPTION_LIMIT = 200;

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
    publisher_name: item.publisher_name || '匿名侦探',
    created_text: formatTime(item.created_at),
    deadline_text: item.deadline ? formatTime(item.deadline) : '长期有效',
    status_text: statusText(item.status),
    can_accept: !expired && !item.is_mine && !my_acceptance && ['recruiting', 'in_progress'].includes(item.status),
    is_expired: expired,
    accepted_by_me: !!my_acceptance,
    my_acceptance_status_text: expired ? '已过期' : (my_acceptance ? statusText(my_acceptance.status) : '')
  };
}

function normalizeAcceptance(item = {}) {
  const acceptance_id = item.acceptance_id || item._id || item.id || '';
  const commission = normalizeCommission(item.commission || {});

  return {
    ...item,
    acceptance_id,
    commission,
    title: item.title || commission.title || '未命名委托',
    reward_points: Number(commission.reward_points || item.reward_points || 0),
    remaining_reward: Number(commission.remaining_reward || 0),
    publisher_name: commission.publisher_name || '发布人',
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
    receiver_name: acc.receiver_name || '匿名侦探',
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
    theme: 'blue',
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
      deadline_date: '',
      deadline_time: ''
    },
    publish_errors: {},
    publish_valid: false,
    accepting_id: '',
    completing_id: '',
    show_reward_modal: false,
    rewarding: false,
    reward_target: null,
    reward_points_input: ''
  },

  onLoad(options = {}) {
    share.rememberInviter(options);
    this.loadTheme();
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    this.refreshCurrentTab();
  },

  loadTheme() {
    applyTheme(this);
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
      this.setData({ error: err.message || '加载失败' });
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
      const result = await pointsService.getUserPoints();
      if (!result.success) return;
      this.setData({
        user_points: {
          available_points: Number(result.available_points || 0),
          frozen_points: Number(result.frozen_points || 0),
          total_points: Number(result.total_points || 0)
        }
      });
    } catch (err) {
      console.error('Load points failed:', err);
    }
  },

  async loadCommissions() {
    try {
      const result = await commissionService.getCommissions({
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.error || '加载委托列表失败');

      const list = (result.data || []).map(normalizeCommission);
      this.setData({ commissions: list, error: '' });
    } catch (err) {
      console.error('Load commissions failed:', err);
      this.setData({ error: err.message || '网络异常' });
    }
  },

  async loadMyCommissions() {
    try {
      const result = await commissionService.getMyCommissions();
      if (!result.success) return;

      this.setData({
        published: (result.published || []).map(normalizePublished),
        accepted: (result.accepted || []).map(normalizeAcceptance)
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
    if (!interaction.canRefresh(this)) return;
    this.setData({ refreshing: true });
    try {
      await this.initPage();
    } finally {
      interaction.finishRefresh(this);
    }
  },

  openPublishModal() {
    this.setData({
      show_publish_modal: true,
      publish_form: {
        title: '',
        description: '',
        reward_points: '',
        deadline_date: '',
        deadline_time: ''
      },
      publish_errors: {},
      publish_valid: false
    });
  },

  closePublishModal() {
    if (this.data.publishing) return;
    this.setData({ show_publish_modal: false });
  },

  onPublishInput(e) {
    const field = e.currentTarget.dataset.field;
    this.updatePublishField(field, e.detail.value);
  },

  onDeadlineDateChange(e) {
    this.updatePublishField('deadline_date', e.detail.value);
  },

  onDeadlineTimeChange(e) {
    this.updatePublishField('deadline_time', e.detail.value);
  },

  updatePublishField(field, value) {
    const publish_form = {
      ...this.data.publish_form,
      [field]: value
    };
    const validation = this.validatePublishForm(publish_form);
    this.setData({
      publish_form,
      publish_errors: validation.errors,
      publish_valid: validation.valid
    });
  },

  buildDeadline(form = this.data.publish_form) {
    if (!form.deadline_date) return '';
    return `${form.deadline_date} ${form.deadline_time || '23:59'}`;
  },

  validatePublishForm(form = this.data.publish_form) {
    const reward_points = Number(form.reward_points);
    const errors = {};

    if (!form.title.trim()) {
      errors.title = '请填写标题';
    }
    if (!form.description.trim()) {
      errors.description = '请填写描述';
    }
    if (form.description && form.description.length > DESCRIPTION_LIMIT) {
      errors.description = `内容不能超过 ${DESCRIPTION_LIMIT} 字`;
    }
    if (!Number.isInteger(reward_points) || reward_points <= 0) {
      errors.reward_points = '奖励积分需为正整数';
    }
    if (reward_points > this.data.user_points.available_points) {
      errors.reward_points = '可用积分不足';
    }
    if (form.deadline_time && !form.deadline_date) {
      errors.deadline = '请先选择截止日期';
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors
    };
  },

  publishCommission() {
    const validation = this.validatePublishForm();
    this.setData({
      publish_errors: validation.errors,
      publish_valid: validation.valid
    });
    if (!validation.valid) {
      wx.showToast({ title: Object.values(validation.errors)[0] || '请检查表单', icon: 'none' });
      return;
    }

    const form = this.data.publish_form;
    this.selectComponent('#publishConfirm').show({
      title: '确认发布委托',
      content: `发布后将冻结 ${Number(form.reward_points)} 积分作为奖励。`,
      confirmText: '确认发布',
      cancelText: '再检查'
    });
  },

  async executePublishCommission() {
    const form = this.data.publish_form;
    const reward_points = Number(form.reward_points);
    if (this.data.publishing) return;

    this.setData({ publishing: true });
    try {
      await subscribe.requestSubscribe(subscribe.TEMPLATES.COMMISSION_ACCEPTED);

      const result = await commissionService.publishCommission({
        title: form.title.trim(),
        content: form.description.trim(),
        reward_points,
        deadline: this.buildDeadline(form)
      });
      if (!result.success) throw new Error(result.error || '发布失败');

      wx.showToast({ title: '发布成功', icon: 'success' });
      this.setData({ show_publish_modal: false, tab: 'published' });
      await Promise.all([this.loadUserPoints(), this.loadCommissions(), this.loadMyCommissions()]);
    } catch (err) {
      wx.showToast({ title: err.message || '发布失败', icon: 'none' });
    } finally {
      this.setData({ publishing: false });
    }
  },

  goCommissionDetail(e) {
    const commission_id = e.currentTarget.dataset.commission_id;
    if (!commission_id) return;
    wx.navigateTo({
      url: `/pages/commission/detail?commission_id=${encodeURIComponent(commission_id)}`
    });
  },

  async acceptCommission(e) {
    const commission_id = e.currentTarget.dataset.commission_id;
    this.setData({ accepting_id: commission_id });
    try {
      await subscribe.requestSubscribe(subscribe.TEMPLATES.COMMISSION_REWARD);

      const result = await commissionService.acceptCommission(commission_id);
      if (!result.success) throw new Error(result.error || '领取失败');

      wx.showToast({ title: '领取成功', icon: 'success' });
      await Promise.all([this.loadCommissions(), this.loadMyCommissions()]);
    } catch (err) {
      wx.showToast({ title: err.message || '领取失败', icon: 'none' });
    } finally {
      this.setData({ accepting_id: '' });
    }
  },

  async completeCommission(e) {
    const acceptance_id = e.currentTarget.dataset.acceptance_id;
    this.setData({ completing_id: acceptance_id });
    try {
      await subscribe.requestSubscribe(subscribe.TEMPLATES.COMMISSION_REWARD);

      const result = await commissionService.completeCommission(acceptance_id);
      if (!result.success) throw new Error(result.error || '提交失败');

      wx.showToast({ title: '已提交', icon: 'success' });
      await this.loadMyCommissions();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
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
      wx.showToast({ title: '积分无效', icon: 'none' });
      return;
    }
    if (allocated_points > target.max) {
      wx.showToast({ title: '超过可发放上限', icon: 'none' });
      return;
    }

    this.setData({ rewarding: true });
    try {
      const result = await commissionService.allocateRewards({
        commission_id: target.commission_id,
        acceptance_id: target.acceptance_id,
        allocated_points
      });
      if (!result.success) throw new Error(result.error || '发放失败');

      wx.showToast({ title: '已发放', icon: 'success' });
      this.setData({ show_reward_modal: false, reward_target: null, reward_points_input: '' });
      await Promise.all([this.loadUserPoints(), this.loadCommissions(), this.loadMyCommissions()]);
    } catch (err) {
      wx.showToast({ title: err.message || '发放失败', icon: 'none' });
    } finally {
      this.setData({ rewarding: false });
    }
  },

  onRetry() {
    this.initPage();
  },

  onShareAppMessage() {
    return {
      title: '推协委托',
      path: share.appendShareParams('/pages/commission/index')
    };
  },

  onShareTimeline() {
    return {
      title: '推协委托',
      query: share.appendShareParams('').replace(/^\?/, '')
    };
  },

  noop() {}
});
