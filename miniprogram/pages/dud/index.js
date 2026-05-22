const { request } = require('../../utils/request');

function toDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (value.$date) return new Date(value.$date);
  return new Date(value);
}

function formatTime(value) {
  const date = toDate(value);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function normalizeMessage(item, index) {
  return {
    message_id: item.message_id || item._id || `${Date.now()}_${index}`,
    type: item.type === 'dud' ? 'dud' : 'user',
    message: item.message || item.content || '',
    time_text: formatTime(item.created_at),
    matched_keyword: item.matched_keyword || '',
    match_type: item.match_type || '',
    rule_id: item.rule_id || ''
  };
}

Page({
  data: {
    messages: [],
    input_value: '',
    loading: true,
    sending: false,
    error: '',
    scroll_into_view: '',
    quick_prompts: ['你好', '帮助', '积分', '排行', '活动']
  },

  onLoad() {
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await request.callCloudFunction('dud_getChatHistory', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || '加载历史失败');

      const list = ((result.data && result.data.list) || []).map(normalizeMessage);
      const messages = list.length > 0 ? list : [{
        message_id: 'welcome',
        type: 'dud',
        message: '我是 Dud。把关键词丢给我，我会从线索库里找对应回复。',
        time_text: formatTime(new Date())
      }];

      this.setData({ messages, loading: false }, () => this.scrollToBottom());
    } catch (error) {
      console.error('Load Dud history failed:', error);
      this.setData({
        error: error.message || '加载失败',
        loading: false
      });
    }
  },

  onInput(event) {
    this.setData({ input_value: event.detail.value });
  },

  usePrompt(event) {
    const text = event.currentTarget.dataset.text;
    this.setData({ input_value: text });
    this.sendMessage();
  },

  async sendMessage() {
    const message = this.data.input_value.trim();
    if (!message) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }

    if (message.length > 200) {
      wx.showToast({ title: '内容不能超过 200 字', icon: 'none' });
      return;
    }

    const now = new Date();
    const pending_message = normalizeMessage({
      message_id: `local_user_${now.getTime()}`,
      type: 'user',
      message,
      created_at: now
    }, 0);

    this.setData({
      input_value: '',
      sending: true,
      messages: [...this.data.messages, pending_message]
    }, () => this.scrollToBottom());

    try {
      const result = await request.callCloudFunction('dud_chat', { message });
      if (!result.success) throw new Error(result.message || '发送失败');

      const data = result.data || {};
      const dud_message = normalizeMessage({
        message_id: `local_dud_${Date.now()}`,
        type: 'dud',
        message: data.reply_content || (data.dud_message && data.dud_message.message),
        created_at: new Date(),
        matched_keyword: data.matched_keyword,
        match_type: data.match_type,
        rule_id: data.rule_id
      }, 0);

      this.setData({
        messages: [...this.data.messages, dud_message],
        sending: false
      }, () => this.scrollToBottom());
    } catch (error) {
      console.error('Send Dud message failed:', error);
      const fail_message = normalizeMessage({
        message_id: `local_error_${Date.now()}`,
        type: 'dud',
        message: error.message || 'Dud 暂时离线了，请稍后再试。',
        created_at: new Date()
      }, 0);

      this.setData({
        messages: [...this.data.messages, fail_message],
        sending: false
      }, () => this.scrollToBottom());
    }
  },

  scrollToBottom() {
    const last = this.data.messages[this.data.messages.length - 1];
    if (!last) return;
    this.setData({ scroll_into_view: `msg-${last.message_id}` });
  },

  onRetry() {
    this.loadHistory();
  },

  async onPullDownRefresh() {
    try {
      await this.loadHistory();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onShareAppMessage() {
    return {
      title: 'Dud 对话',
      path: '/pages/dud/index'
    };
  }
});
