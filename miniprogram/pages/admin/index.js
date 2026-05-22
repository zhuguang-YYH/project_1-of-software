const { request } = require('../../utils/request');

function formatTime(value) {
  if (!value) return '';
  const raw = value.$date || value;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function borrowStatusText(status) {
  return ({
    applying: '待审核',
    confirmed: '已确认',
    in_transit: '待交付',
    borrowed: '借阅中',
    returned: '已归还',
    cancelled: '已取消'
  })[status] || status || '未知';
}

function exchangeStatusText(status) {
  return ({
    pending: '待领取',
    shipped: '待领取',
    completed: '已完成',
    received: '已领取',
    cancelled: '已取消'
  })[status] || status || '未知';
}

function feedbackTypeText(type) {
  return ({
    general: '一般反馈',
    bug: '问题反馈',
    activity: '活动建议',
    feature: '功能建议',
    content: '内容建议'
  })[type] || type || '用户反馈';
}

function feedbackStatusText(status) {
  return ({
    pending: '待处理',
    processing: '处理中',
    resolved: '已处理',
    closed: '已关闭'
  })[status] || status || '待处理';
}

function todayText() {
  return new Date().toISOString().split('T')[0];
}

Page({
  data: {
    loading: true,
    saving: false,
    processing_id: '',
    error: '',
    tab: 'puzzle',
    stats: {},
    feedback_list: [],
    log_list: [],
    borrow_applications: [],
    exchange_records: [],
    tabs: [
      { key: 'puzzle', label: '谜题' },
      { key: 'activity', label: '活动' },
      { key: 'borrow', label: '物资' },
      { key: 'exchange', label: '兑换' },
      { key: 'recommendation', label: '推荐' },
      { key: 'dud', label: 'Dud' },
      { key: 'feedback', label: '反馈' },
      { key: 'logs', label: '日志' },
      { key: 'settings', label: '设置' }
    ],
    puzzleForm: {
      publish_date: '',
      content: '',
      options_text: '选项A\n选项B\n选项C\n选项D',
      correct_answer: '',
      answer_explanation: '',
      difficulty: 'easy',
      reward_points: '10'
    },
    activityForm: {
      title: '',
      description: '',
      location: '',
      capacity: '',
      cancel_deadline: '',
      start_time: '',
      end_time: ''
    },
    borrowForm: {
      item_name: '',
      description: '',
      category: '',
      item_type: 'book',
      total_quantity: '1',
      genre: '',
      min_players: '',
      max_players: '',
      duration_minutes: '',
      difficulty: ''
    },
    exchangeForm: {
      item_name: '',
      description: '',
      category: 'general',
      exchange_points: '',
      original_cost: '',
      total_quantity: ''
    },
    recommendationForm: {
      title: '',
      category: 'book',
      recommender_name: '',
      reason: '',
      link_url: '',
      cover_url: '',
      status: 'published'
    },
    dudForm: {
      keyword: '',
      reply_content: '',
      match_type: 'exact',
      priority: '0'
    },
    systemSettingsForm: {
      puzzle_publish_time: '09:00',
      default_puzzle_reward: '10',
      activity_cancel_hours: '24',
      recommendation_enabled: true,
      commission_enabled: true
    }
  },

  onLoad() {
    this.setData({
      'puzzleForm.publish_date': todayText()
    });
    this.initPage();
  },

  async initPage() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadDashboard(),
        this.loadFeedback(),
        this.loadBorrowApplications(),
        this.loadExchangeRecords(),
        this.loadLogs(),
        this.loadSystemSettings()
      ]);
    } catch (error) {
      console.error('Admin init failed:', error);
      this.setData({ error: error.message || '后台加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadDashboard() {
    const result = await request.callCloudFunction('admin_getDashboard', {});
    if (!result.success) throw new Error(result.message || '没有后台权限');
    this.setData({ stats: result.data || {} });
  },

  async loadFeedback() {
    const result = await request.callCloudFunction('admin_getFeedback', { status: 'all' });
    if (!result.success) return;
    const list = ((result.data && result.data.list) || []).map(item => ({
      ...item,
      feedback_id: item.feedback_id || item._id,
      feedback_title: feedbackTypeText(item.feedback_type),
      anonymous_text: item.is_anonymous ? '匿名' : '',
      created_text: formatTime(item.created_at),
      status_text: feedbackStatusText(item.status)
    }));
    this.setData({ feedback_list: list });
  },

  async loadLogs() {
    const result = await request.callCloudFunction('admin_getLogs', { page: 1, page_size: 30 });
    if (!result.success) return;
    const list = ((result.data && result.data.list) || []).map(item => ({
      ...item,
      log_id: item.log_id || item._id,
      operation_text: item.operation_type || '',
      target_text: item.target_collection || '',
      target_id_text: item.target_id || '',
      created_text: formatTime(item.created_at)
    }));
    this.setData({ log_list: list });
  },

  async loadBorrowApplications() {
    const result = await request.callCloudFunction('admin_getBorrowApplications', { status: 'active' });
    if (!result.success) return;
    const list = ((result.data && result.data.list) || []).map(item => ({
      ...item,
      application_id: item.application_id || item._id,
      created_text: formatTime(item.requested_at || item.created_at),
      status_text: borrowStatusText(item.status),
      can_lend: ['applying', 'confirmed', 'in_transit'].includes(item.status),
      can_return: item.status === 'borrowed',
      can_cancel: ['applying', 'confirmed', 'in_transit'].includes(item.status)
    }));
    this.setData({ borrow_applications: list });
  },

  async loadExchangeRecords() {
    const result = await request.callCloudFunction('admin_getExchangeRecords', { status: 'active' });
    if (!result.success) return;
    const list = ((result.data && result.data.list) || []).map(item => ({
      ...item,
      exchange_id: item.exchange_id || item._id,
      created_text: formatTime(item.created_at || item.exchange_time),
      status_text: exchangeStatusText(item.status),
      total_cost_text: Number(item.points_cost || item.total_cost || 0),
      quantity_text: Number(item.quantity || 1),
      can_process: !['completed', 'received', 'cancelled'].includes(item.status)
    }));
    this.setData({ exchange_records: list });
  },

  async loadSystemSettings() {
    const result = await request.callCloudFunction('admin_getSystemSettings', {});
    if (!result.success) return;
    const data = result.data || {};
    this.setData({
      systemSettingsForm: {
        puzzle_publish_time: data.puzzle_publish_time || '09:00',
        default_puzzle_reward: String(data.default_puzzle_reward || 10),
        activity_cancel_hours: String(data.activity_cancel_hours || 24),
        recommendation_enabled: data.recommendation_enabled !== false,
        commission_enabled: data.commission_enabled !== false
      }
    });
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab === 'borrow') this.loadBorrowApplications();
    if (tab === 'exchange') this.loadExchangeRecords();
    if (tab === 'feedback') this.loadFeedback();
    if (tab === 'logs') this.loadLogs();
  },

  onFormInput(event) {
    const { form, field } = event.currentTarget.dataset;
    if (!form || !field) return;
    this.setData({
      [`${form}.${field}`]: event.detail.value
    });
  },

  onFormSwitch(event) {
    const { form, field } = event.currentTarget.dataset;
    if (!form || !field) return;
    this.setData({
      [`${form}.${field}`]: event.detail.value
    });
  },

  async submitAction(action, payload, success_text) {
    this.setData({ saving: true });
    try {
      const result = await request.callCloudFunction(`admin_${action}`, payload);
      if (!result.success) throw new Error(result.message || '保存失败');
      wx.showToast({ title: success_text, icon: 'success' });
      await this.loadDashboard();
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
      return false;
    } finally {
      this.setData({ saving: false });
    }
  },

  async savePuzzle() {
    const form = this.data.puzzleForm;
    const ok = await this.submitAction('savePuzzle', {
      ...form,
      reward_points: Number(form.reward_points)
    }, '谜题已保存');
    if (ok) {
      this.setData({
        'puzzleForm.content': '',
        'puzzleForm.correct_answer': '',
        'puzzleForm.answer_explanation': ''
      });
    }
  },

  async createActivity() {
    const ok = await this.submitAction('createActivity', this.data.activityForm, '活动已创建');
    if (ok) {
      this.setData({
        activityForm: {
          title: '',
          description: '',
          location: '',
          capacity: '',
          cancel_deadline: '',
          start_time: '',
          end_time: ''
        }
      });
    }
  },

  async createBorrowItem() {
    const ok = await this.submitAction('createBorrowItem', this.data.borrowForm, '物资已添加');
    if (ok) {
      this.setData({
        borrowForm: {
          item_name: '',
          description: '',
          category: '',
          item_type: 'book',
          total_quantity: '1',
          genre: '',
          min_players: '',
          max_players: '',
          duration_minutes: '',
          difficulty: ''
        }
      });
    }
  },

  async createExchangeGood() {
    const ok = await this.submitAction('createExchangeGood', this.data.exchangeForm, '商品已添加');
    if (ok) {
      this.setData({
        exchangeForm: {
          item_name: '',
          description: '',
          category: 'general',
          exchange_points: '',
          original_cost: '',
          total_quantity: ''
        }
      });
    }
  },

  async createRecommendation() {
    const ok = await this.submitAction('createRecommendation', this.data.recommendationForm, '推荐已发布');
    if (ok) {
      this.setData({
        recommendationForm: {
          title: '',
          category: 'book',
          recommender_name: '',
          reason: '',
          link_url: '',
          cover_url: '',
          status: 'published'
        }
      });
    }
  },

  async createDudKeyword() {
    const ok = await this.submitAction('createDudKeyword', this.data.dudForm, '关键词已添加');
    if (ok) {
      this.setData({
        dudForm: {
          keyword: '',
          reply_content: '',
          match_type: 'exact',
          priority: '0'
        }
      });
    }
  },

  async saveSystemSettings() {
    const form = this.data.systemSettingsForm;
    await this.submitAction('saveSystemSettings', {
      puzzle_publish_time: form.puzzle_publish_time,
      default_puzzle_reward: Number(form.default_puzzle_reward),
      activity_cancel_hours: Number(form.activity_cancel_hours),
      recommendation_enabled: form.recommendation_enabled,
      commission_enabled: form.commission_enabled
    }, '设置已保存');
  },

  async resolveFeedback(event) {
    const feedback_id = event.currentTarget.dataset.id;
    const ok = await this.submitAction('updateFeedback', {
      feedback_id,
      status: 'resolved'
    }, '反馈已处理');
    if (ok) await this.loadFeedback();
  },

  async updateBorrowStatus(event) {
    const { id, status } = event.currentTarget.dataset;
    if (!id || !status) return;
    const text = status === 'borrowed' ? '已确认借出' : (status === 'returned' ? '已确认归还' : '已取消申请');

    this.setData({ processing_id: id });
    const ok = await this.submitAction('updateBorrowStatus', { application_id: id, status }, text);
    this.setData({ processing_id: '' });
    if (ok) await this.loadBorrowApplications();
  },

  async updateExchangeStatus(event) {
    const { id, status } = event.currentTarget.dataset;
    if (!id || !status) return;
    const text = status === 'completed' ? '兑换已完成' : '兑换已取消';

    this.setData({ processing_id: id });
    const ok = await this.submitAction('updateExchangeStatus', { exchange_id: id, status }, text);
    this.setData({ processing_id: '' });
    if (ok) {
      await Promise.all([
        this.loadExchangeRecords(),
        this.loadDashboard()
      ]);
    }
  },

  async onPullDownRefresh() {
    try {
      await this.initPage();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onRetry() {
    this.initPage();
  }
});
