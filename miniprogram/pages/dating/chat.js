const datingService = require('../../services/dating.js');
const { applyTheme } = require('../../utils/theme.js');
const { storage } = require('../../utils/storage.js');

const GAME_TYPES = [
  { key: 'script_kill', label: '剧本杀', icon: '🎭' },
  { key: 'board_game', label: '桌游', icon: '🎲' },
  { key: 'puzzle', label: '解谜', icon: '🧩' },
  { key: 'activity', label: '活动', icon: '🎪' },
  { key: 'other', label: '其他', icon: '🎯' }
];

function formatTime(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  } catch (_) { return ''; }
}

Page({
  data: {
    match_id: '',
    other_user: { user_id: '', display_name: '好友', avatar_url: '' },
    my_avatar_url: '',
    messages: [],
    input_value: '',
    loading: true,
    sending: false,
    error: '',
    theme: 'blue',
    scroll_into_view: '',
    show_invite_panel: false,
    invite_game_type: 'script_kill',
    invite_game_name: '',
    invite_message: '',
    invite_sending: false,
    gameTypes: GAME_TYPES,
    has_more: false,
    page: 1
  },

  onLoad(options) {
    const userInfo = storage.getUserInfo() || {};
    this.setData({
      match_id: options.matchId || '',
      my_avatar_url: userInfo.avatar_url || '',
      other_user: {
        user_id: options.userId || '',
        display_name: decodeURIComponent(options.name || '好友'),
        avatar_url: decodeURIComponent(options.avatar || '')
      }
    });
    wx.setNavigationBarTitle({ title: this.data.other_user.display_name });
    this.loadTheme();
    this.loadMessages(1);
  },

  onShow() {
    this.loadTheme();
  },

  loadTheme() {
    applyTheme(this);
  },

  async loadMessages(page) {
    if (!this.data.match_id) return;
    if (page === 1) this.setData({ loading: true, error: '' });

    try {
      const result = await datingService.getMessages(this.data.match_id, { page, page_size: 30 });
      if (!result.success) throw new Error(result.error || '加载失败');

      const data = result.data || {};
      const list = (data.messages || []).map(item => ({
        message_id: item.message_id,
        is_me: item.from_user_id !== this.data.other_user.user_id,
        content_type: item.content_type,
        content: item.content,
        game_data: item.game_data,
        time_text: formatTime(item.created_at),
        created_at: item.created_at,
        _pending: false,
        _failed: false
      }));

      if (page === 1) {
        this.setData({
          messages: list,
          loading: false,
          page: 1,
          has_more: !!data.has_more
        }, () => this.scrollToBottom());
      } else {
        this.setData({
          messages: [...list, ...this.data.messages],
          page,
          has_more: !!data.has_more
        });
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
      this.setData({ error: err.message, loading: false });
    }
  },

  async onReachTop() {
    if (this.data.loading || !this.data.has_more) return;
    await this.loadMessages(this.data.page + 1);
  },

  onInput(e) {
    this.setData({ input_value: e.detail.value });
  },

  async sendMessage() {
    const text = this.data.input_value.trim();
    if (!text || this.data.sending) return;

    const localMsg = {
      message_id: `local_${Date.now()}`,
      is_me: true,
      content_type: 'text',
      content: text,
      game_data: null,
      time_text: formatTime(new Date()),
      _pending: true,
      _failed: false
    };

    this.setData({
      input_value: '',
      sending: true,
      messages: [...this.data.messages, localMsg]
    }, () => this.scrollToBottom());

    try {
      const result = await datingService.sendMessage({
        match_id: this.data.match_id,
        to_user_id: this.data.other_user.user_id,
        content_type: 'text',
        content: text
      });

      if (!result.success) throw new Error(result.error || '发送失败');

      const serverMsg = result.data && result.data.message;
      const msgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) {
          return {
            ...m,
            message_id: (serverMsg && serverMsg.message_id) || m.message_id,
            _pending: false
          };
        }
        return m;
      });

      this.setData({ messages: msgs, sending: false });
    } catch (err) {
      const msgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) return { ...m, _pending: false, _failed: true };
        return m;
      });
      this.setData({ messages: msgs, sending: false });
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    }
  },

  toggleInvitePanel() {
    this.setData({
      show_invite_panel: !this.data.show_invite_panel,
      invite_game_type: 'script_kill',
      invite_game_name: '',
      invite_message: ''
    });
  },

  selectGameType(e) {
    this.setData({ invite_game_type: e.currentTarget.dataset.type });
  },

  onInviteGameNameInput(e) {
    this.setData({ invite_game_name: e.detail.value });
  },

  onInviteMessageInput(e) {
    this.setData({ invite_message: e.detail.value });
  },

  async sendGameInvite() {
    if (!this.data.invite_game_type || this.data.invite_sending) return;

    const gameType = GAME_TYPES.find(g => g.key === this.data.invite_game_type) || {};
    const game_data = {
      game_type: this.data.invite_game_type,
      game_name: this.data.invite_game_name.trim() || gameType.label || '游戏邀请',
      message: this.data.invite_message.trim()
    };

    const localMsg = {
      message_id: `local_inv_${Date.now()}`,
      is_me: true,
      content_type: 'game_invite',
      content: game_data.game_name,
      game_data,
      time_text: formatTime(new Date()),
      _pending: true,
      _failed: false
    };

    this.setData({
      show_invite_panel: false,
      invite_sending: true,
      messages: [...this.data.messages, localMsg]
    }, () => this.scrollToBottom());

    try {
      const result = await datingService.sendMessage({
        match_id: this.data.match_id,
        to_user_id: this.data.other_user.user_id,
        content_type: 'game_invite',
        game_data
      });

      if (!result.success) throw new Error(result.error || '发送失败');

      const serverMsg = result.data && result.data.message;
      const msgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) {
          return { ...m, message_id: (serverMsg && serverMsg.message_id) || m.message_id, _pending: false };
        }
        return m;
      });

      this.setData({ messages: msgs, invite_sending: false });
    } catch (err) {
      const msgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) return { ...m, _pending: false, _failed: true };
        return m;
      });
      this.setData({ messages: msgs, invite_sending: false });
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    }
  },

  scrollToBottom() {
    const msgs = this.data.messages;
    if (msgs.length === 0) return;
    this.setData({ scroll_into_view: `msg-${msgs[msgs.length - 1].message_id}` });
  },

  retryMessage(e) {
    const msgId = e.currentTarget.dataset.msgId;
    const msg = this.data.messages.find(m => m.message_id === msgId);
    if (!msg || !msg._failed) return;
    const filtered = this.data.messages.filter(m => m.message_id !== msgId);
    this.setData({ messages: filtered });
    if (msg.content_type === 'game_invite') {
      this.resendGameInvite(msg);
    } else {
      this.setData({ input_value: msg.content }, () => this.sendMessage());
    }
  },

  async resendGameInvite(msg) {
    const localMsg = { ...msg, message_id: `local_retry_${Date.now()}`, _pending: true, _failed: false };
    this.setData({ invite_sending: true, messages: [...this.data.messages, localMsg] }, () => this.scrollToBottom());

    try {
      const result = await datingService.sendMessage({
        match_id: this.data.match_id,
        to_user_id: this.data.other_user.user_id,
        content_type: 'game_invite',
        game_data: msg.game_data
      });
      if (!result.success) throw new Error(result.error || '发送失败');
      const serverMsg = result.data && result.data.message;
      const msgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) {
          return { ...m, message_id: (serverMsg && serverMsg.message_id) || m.message_id, _pending: false };
        }
        return m;
      });
      this.setData({ messages: msgs, invite_sending: false });
    } catch (err) {
      const msgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) return { ...m, _pending: false, _failed: true };
        return m;
      });
      this.setData({ messages: msgs, invite_sending: false });
    }
  },

  // ========== 游戏邀请响应 ==========

  async respondGameInvite(e) {
    const { msgId, action } = e.currentTarget.dataset;
    if (!msgId || !action) return;

    const msgs = this.data.messages.map(m => {
      if (m.message_id === msgId) {
        return {
          ...m,
          game_data: { ...(m.game_data || {}), responded: action }
        };
      }
      return m;
    });
    this.setData({ messages: msgs });

    // 发送响应文本
    const response_text = action === 'accept'
      ? '我接受你的游戏邀请！'
      : '抱歉，我先不参加了~';

    const localMsg = {
      message_id: `local_resp_${Date.now()}`,
      is_me: true,
      content_type: 'text',
      content: response_text,
      game_data: null,
      time_text: this._formatTime(new Date()),
      _pending: true,
      _failed: false
    };

    this.setData({
      messages: [...this.data.messages, localMsg],
      sending: true
    }, () => this.scrollToBottom());

    try {
      const result = await datingService.sendMessage({
        match_id: this.data.match_id,
        to_user_id: this.data.other_user.user_id,
        content_type: 'text',
        content: response_text
      });

      if (!result.success) throw new Error(result.error || '发送失败');

      const serverMsg = result.data && result.data.message;
      const finalMsgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) {
          return {
            ...m,
            message_id: (serverMsg && serverMsg.message_id) || m.message_id,
            _pending: false
          };
        }
        return m;
      });

      this.setData({ messages: finalMsgs, sending: false });
    } catch (err) {
      const finalMsgs = this.data.messages.map(m => {
        if (m.message_id === localMsg.message_id) return { ...m, _pending: false, _failed: true };
        return m;
      });
      this.setData({ messages: finalMsgs, sending: false });
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    }
  },

  onRetry() {
    this.loadMessages(1);
  },

  async onPullDownRefresh() {
    try { await this.loadMessages(1); }
    finally { wx.stopPullDownRefresh(); }
  },

  onShareAppMessage() {
    return {
      title: `NK推协 · 与 ${this.data.other_user.display_name} 的聊天`,
      path: '/pages/dating/matches'
    };
  },

  // 占位函数 — WXML catchtouchmove 引用
  noop() {},

  _formatTime(value) {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      return `${hour}:${minute}`;
    } catch (_) { return ''; }
  }
});
