const adminService = require('../../services/admin.js');
const upload = require('../../utils/upload.js');
const { applyTheme } = require('../../utils/theme.js');

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

function todayText() {
  return new Date().toISOString().split('T')[0];
}

function buildTimeOptions(step = 30) {
  const list = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
    const minute = String(minutes % 60).padStart(2, '0');
    list.push({ label: `${hour}:${minute}`, value: `${hour}:${minute}` });
  }
  return list;
}

function buildHourOptions() {
  return Array.from({ length: 24 }, (_, index) => {
    const value = String(index + 1);
    return { label: `${value} 小时`, value };
  });
}

function combineDateTime(date, time) {
  if (!date && !time) return '';
  if (!date) return time || '';
  return `${date} ${time || '00:00'}`;
}

function optionLabel(options, value, fallback = '请选择') {
  const item = (options || []).find(current => current.value === value);
  return item ? item.label : fallback;
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

function exchangeGoodStatusText(status) {
  return ({
    available: '上架中',
    offline: '已下架',
    discontinued: '已停用'
  })[status] || status || '未知';
}

function exchangeGoodTagText(tag_type, tag_text) {
  return String(tag_text || ({
    new: '新品',
    limited: '限量',
    limited_time: '限时'
  })[tag_type] || '').trim();
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

Page({
  data: {
    loading: true,
    saving: false,
    processing_id: '',
    uploading_field: '',
    error: '',
    tab: 'puzzle',
    theme: 'blue',
    stats: {},
    feedback_list: [],
    log_list: [],
    borrow_applications: [],
    exchange_records: [],
    exchange_goods: [],
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
    difficultyOptions: [
      { label: '简单', value: 'easy' },
      { label: '中等', value: 'medium' },
      { label: '困难', value: 'hard' }
    ],
    answerOptions: [
      { label: 'A', value: 'A' },
      { label: 'B', value: 'B' },
      { label: 'C', value: 'C' },
      { label: 'D', value: 'D' }
    ],
    itemTypeOptions: [
      { label: '书籍', value: 'book' },
      { label: '剧本杀', value: 'script' },
      { label: '道具/物资', value: 'supplies' }
    ],
    inventoryCategoryOptions: [
      { label: '推理小说', value: 'book' },
      { label: '剧本杀', value: 'script' },
      { label: '活动物资', value: 'activity' },
      { label: '桌游道具', value: 'boardgame' },
      { label: '其他', value: 'other' }
    ],
    scriptGenreOptions: [
      { label: '本格', value: '本格' },
      { label: '变格', value: '变格' },
      { label: '机制', value: '机制' },
      { label: '情感', value: '情感' },
      { label: '阵营', value: '阵营' },
      { label: '欢乐', value: '欢乐' }
    ],
    exchangeCategoryOptions: [
      { label: '通用', value: 'general' },
      { label: '社团周边', value: 'merch' },
      { label: '活动奖励', value: 'activity' },
      { label: '书籍/资料', value: 'book' },
      { label: '其他', value: 'other' }
    ],
    exchangeTagOptions: [
      { label: '无标签', value: '' },
      { label: '新品', value: 'new' },
      { label: '限量', value: 'limited' },
      { label: '限时', value: 'limited_time' }
    ],
    recommendationCategoryOptions: [
      { label: '书籍', value: 'book' },
      { label: '游戏', value: 'game' },
      { label: '剧本', value: 'script' },
      { label: '活动', value: 'activity' },
      { label: '影视', value: 'media' },
      { label: '其他', value: 'other' }
    ],
    matchTypeOptions: [
      { label: '精确匹配', value: 'exact' },
      { label: '模糊匹配', value: 'fuzzy' }
    ],
    publishTimeOptions: buildTimeOptions(30),
    cancelHourOptions: buildHourOptions(),
    puzzleForm: {
      publish_date: '',
      content: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_answer: 'A',
      answer_explanation: '',
      difficulty: 'easy',
      reward_points: '10'
    },
    activityForm: {
      title: '',
      description: '',
      location: '',
      capacity: '',
      cancel_date: '',
      cancel_time: '20:00',
      start_date: '',
      start_time_only: '19:00',
      end_date: '',
      end_time_only: '21:00',
      cover_url: ''
    },
    borrowForm: {
      item_name: '',
      description: '',
      category: 'book',
      item_type: 'book',
      total_quantity: '1',
      genre: '本格',
      min_players: '',
      max_players: '',
      duration_minutes: '',
      difficulty: 'easy',
      cover_url: ''
    },
    exchangeForm: {
      item_name: '',
      description: '',
      category: 'general',
      exchange_points: '',
      original_cost: '',
      total_quantity: '',
      tag_type: '',
      tag_text: '',
      stock_warning_threshold: '3',
      cover_url: ''
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
    this.loadTheme();
    const today = todayText();
    this.setData({
      'puzzleForm.publish_date': today,
      'activityForm.cancel_date': today,
      'activityForm.start_date': today,
      'activityForm.end_date': today
    });
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
        this.loadDashboard(),
        this.loadFeedback(),
        this.loadBorrowApplications(),
        this.loadExchangeGoods(),
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
    const result = await adminService.getDashboard();
    if (!result.success) throw new Error(result.error || '没有后台权限');
    this.setData({ stats: result.data || {} });
  },

  async loadFeedback() {
    const result = await adminService.getFeedback({ status: 'all' });
    if (!result.success) return;
    const list = (result.data || []).map((item, index) => ({
      ...item,
      feedback_id: item.feedback_id || item._id,
      feedback_title: feedbackTypeText(item.feedback_type),
      anonymous_text: item.is_anonymous ? '匿名' : '',
      created_text: formatTime(item.created_at),
      status_text: feedbackStatusText(item.status),
      reply_draft: item.admin_reply || item.admin_remark || '',
      list_index: index
    }));
    this.setData({ feedback_list: list });
  },

  async loadLogs() {
    const result = await adminService.getLogs({ page: 1, page_size: 30 });
    if (!result.success) return;
    const list = (result.data || []).map(item => ({
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
    const result = await adminService.getBorrowApplications({ status: 'active' });
    if (!result.success) return;
    const list = (result.data || []).map(item => ({
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
    const result = await adminService.getExchangeRecords({ status: 'active' });
    if (!result.success) return;
    const list = (result.data || []).map(item => ({
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

  async loadExchangeGoods() {
    const result = await adminService.getExchangeGoods({ page: 1, page_size: 50 });
    if (!result.success) return;
    const list = (result.data || []).map(item => {
      const tag_text = exchangeGoodTagText(item.tag_type, item.tag_text);
      return {
        ...item,
        item_id: item.item_id || item._id,
        status_text: exchangeGoodStatusText(item.status),
        tag_display: tag_text,
        stock_text: `${Number(item.available_quantity || 0)}/${Number(item.total_quantity || 0)}`,
        stock_warning: !!item.stock_warning,
        can_online: item.status !== 'available',
        can_offline: item.status === 'available'
      };
    });
    this.setData({ exchange_goods: list });
  },

  async loadSystemSettings() {
    const result = await adminService.getSystemSettings();
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
    if (tab === 'exchange') {
      this.loadExchangeGoods();
      this.loadExchangeRecords();
    }
    if (tab === 'feedback') this.loadFeedback();
    if (tab === 'logs') this.loadLogs();
  },

  onFormInput(event) {
    const { form, field } = event.currentTarget.dataset;
    if (!form || !field) return;
    this.setData({ [`${form}.${field}`]: event.detail.value });
  },

  onFormSwitch(event) {
    const { form, field } = event.currentTarget.dataset;
    if (!form || !field) return;
    this.setData({ [`${form}.${field}`]: event.detail.value });
  },

  onPickerChange(event) {
    const { form, field, options } = event.currentTarget.dataset;
    const source = this.data[options] || [];
    const item = source[Number(event.detail.value)];
    if (!form || !field || !item) return;
    this.setData({ [`${form}.${field}`]: item.value });
  },

  onDateChange(event) {
    const { form, field } = event.currentTarget.dataset;
    if (!form || !field) return;
    this.setData({ [`${form}.${field}`]: event.detail.value });
  },

  onTimeChange(event) {
    const { form, field } = event.currentTarget.dataset;
    if (!form || !field) return;
    this.setData({ [`${form}.${field}`]: event.detail.value });
  },

  pickerLabel(event) {
    const { options, value } = event.currentTarget.dataset;
    return optionLabel(this.data[options], value);
  },

  async uploadFormImage(event) {
    const { form, field, dir } = event.currentTarget.dataset;
    if (!form || !field) return;
    const stateKey = `${form}.${field}`;
    this.setData({ uploading_field: stateKey });
    try {
      const result = await upload.chooseAndUpload({
        dir: dir || 'admin',
        owner: form,
        count: 1
      });
      if (!result.success) throw new Error(result.error || '上传失败');
      this.setData({ [stateKey]: result.fileID });
      wx.showToast({ title: '图片已上传', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading_field: '' });
    }
  },

  clearFormImage(event) {
    const { form, field } = event.currentTarget.dataset;
    if (!form || !field) return;
    this.setData({ [`${form}.${field}`]: '' });
  },

  onFeedbackReplyInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ [`feedback_list[${index}].reply_draft`]: event.detail.value });
  },

  async submitAction(action, payload, successText) {
    this.setData({ saving: true });
    try {
      const result = await adminService.mutate(action, payload, '保存失败');
      if (!result.success) throw new Error(result.error || '保存失败');
      wx.showToast({ title: successText, icon: 'success' });
      await this.loadDashboard();
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
      return false;
    } finally {
      this.setData({ saving: false });
    }
  },

  buildPuzzlePayload() {
    const form = this.data.puzzleForm;
    const options = [form.option_a, form.option_b, form.option_c, form.option_d].map(item => String(item || '').trim());
    return {
      ...form,
      options_text: options.join('\n'),
      reward_points: Number(form.reward_points)
    };
  },

  buildActivityPayload() {
    const form = this.data.activityForm;
    return {
      title: form.title,
      description: form.description,
      location: form.location,
      capacity: form.capacity,
      cancel_deadline: combineDateTime(form.cancel_date, form.cancel_time),
      start_time: combineDateTime(form.start_date, form.start_time_only),
      end_time: combineDateTime(form.end_date, form.end_time_only),
      cover_url: form.cover_url
    };
  },

  async savePuzzle() {
    const options = [
      this.data.puzzleForm.option_a,
      this.data.puzzleForm.option_b,
      this.data.puzzleForm.option_c,
      this.data.puzzleForm.option_d
    ].map(item => String(item || '').trim());
    if (options.some(item => !item)) {
      wx.showToast({ title: '请完整填写 A-D 四个选项', icon: 'none' });
      return;
    }

    const ok = await this.submitAction('savePuzzle', this.buildPuzzlePayload(), '谜题已保存');
    if (ok) {
      this.setData({
        'puzzleForm.content': '',
        'puzzleForm.option_a': '',
        'puzzleForm.option_b': '',
        'puzzleForm.option_c': '',
        'puzzleForm.option_d': '',
        'puzzleForm.correct_answer': 'A',
        'puzzleForm.answer_explanation': ''
      });
    }
  },

  async createActivity() {
    const ok = await this.submitAction('createActivity', this.buildActivityPayload(), '活动已创建');
    if (ok) {
      const today = todayText();
      this.setData({
        activityForm: {
          title: '',
          description: '',
          location: '',
          capacity: '',
          cancel_date: today,
          cancel_time: '20:00',
          start_date: today,
          start_time_only: '19:00',
          end_date: today,
          end_time_only: '21:00',
          cover_url: ''
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
          category: 'book',
          item_type: 'book',
          total_quantity: '1',
          genre: '本格',
          min_players: '',
          max_players: '',
          duration_minutes: '',
          difficulty: 'easy',
          cover_url: ''
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
          total_quantity: '',
          tag_type: '',
          tag_text: '',
          stock_warning_threshold: '3',
          cover_url: ''
        }
      });
      await this.loadExchangeGoods();
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
    const { id, index } = event.currentTarget.dataset;
    const item = this.data.feedback_list[Number(index)] || {};
    const reply = String(item.reply_draft || '').trim();
    if (!reply) {
      wx.showToast({ title: '请先填写回复内容', icon: 'none' });
      return;
    }

    const ok = await this.submitAction('updateFeedback', {
      feedback_id: id,
      status: 'resolved',
      admin_remark: reply,
      admin_reply: reply
    }, '反馈已回复');
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

  async updateExchangeGoodStatus(event) {
    const { id, status } = event.currentTarget.dataset;
    if (!id || !status) return;
    const text = status === 'available' ? '商品已上架' : '商品已下架';

    this.setData({ processing_id: id });
    const ok = await this.submitAction('updateExchangeGoodStatus', { item_id: id, status }, text);
    this.setData({ processing_id: '' });
    if (ok) {
      await Promise.all([
        this.loadExchangeGoods(),
        this.loadDashboard()
      ]);
    }
  },

  difficultyLabel(value) {
    return optionLabel(this.data.difficultyOptions, value);
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
