const datingService = require('../../services/dating.js');
const { applyTheme } = require('../../utils/theme.js');

function formatTime(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    if (isToday) return `${hour}:${minute}`;
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  } catch (_) {
    return '';
  }
}

function buildPreview(msg) {
  if (!msg) return '';
  if (msg.content_type === 'game_invite') {
    const game_name = (msg.game_data && msg.game_data.game_name) || msg.content || '游戏邀请';
    return `[游戏] ${game_name}`;
  }
  const text = (msg.content || '').replace(/[\r\n]+/g, ' ');
  return text.length > 30 ? text.slice(0, 30) + '...' : text;
}

Page({
  data: {
    conversations: [],
    friendRequests: [],
    pendingReceiveCount: 0,
    loading: true,
    theme: 'blue',
    error: ''
  },

  onLoad() {
    this.loadTheme();
    this.loadAll();
  },

  onShow() {
    this.loadTheme();
    if (this._loaded) this.loadAll();
  },

  loadTheme() {
    applyTheme(this);
  },

  async loadAll() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadConversations(),
        this.loadFriendRequests()
      ]);
      this._loaded = true;
    } catch (err) {
      console.error('Failed to load data:', err);
      this.setData({ error: err.message || '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadConversations() {
    try {
      const result = await datingService.getConversations();
      if (!result.success) throw new Error(result.error || '加载失败');

      const data = result.data || {};
      const conversations = (data.conversations || []).map(c => ({
        match_id: c.match_id,
        other_user: {
          user_id: c.other_user.user_id,
          display_name: c.other_user.display_name || '神秘侦探',
          avatar_url: c.other_user.avatar_url || ''
        },
        last_message: c.last_message,
        last_content_preview: buildPreview(c.last_message),
        last_time_text: formatTime(c.last_message ? c.last_message.created_at : c.matched_at),
        unread_count: c.unread_count || 0,
        matched_at: c.matched_at
      }));

      this.setData({ conversations });
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  },

  async loadFriendRequests() {
    try {
      const result = await datingService.getFriendRequests();
      if (!result.success) return;

      const data = result.data || {};
      const received = (data.received || []).map(r => ({
        request_id: r.request_id,
        from_user: {
          user_id: r.from_user.user_id,
          display_name: r.from_user.display_name || '神秘侦探',
          avatar_url: r.from_user.avatar_url || ''
        },
        message: r.message,
        is_sent: false,
        created_at_text: formatTime(r.created_at)
      }));

      this.setData({
        friendRequests: received,
        pendingReceiveCount: received.length
      });
    } catch (err) {
      console.error('Failed to load friend requests:', err);
    }
  },

  async acceptRequest(e) {
    const requestId = e.currentTarget.dataset.requestId;
    if (!requestId) return;

    try {
      const result = await datingService.respondFriendRequest(requestId, 'accept');
      if (!result.success) throw new Error(result.error || '操作失败');

      wx.showToast({ title: '已添加好友', icon: 'success' });
      // 从列表移除并刷新
      const updated = this.data.friendRequests.filter(r => r.request_id !== requestId);
      this.setData({
        friendRequests: updated,
        pendingReceiveCount: updated.length
      });
      this.loadConversations(); // 刷新好友列表
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  async declineRequest(e) {
    const requestId = e.currentTarget.dataset.requestId;
    if (!requestId) return;

    try {
      const result = await datingService.respondFriendRequest(requestId, 'decline');
      if (!result.success) throw new Error(result.error || '操作失败');

      const updated = this.data.friendRequests.filter(r => r.request_id !== requestId);
      this.setData({
        friendRequests: updated,
        pendingReceiveCount: updated.length
      });
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  goToChat(e) {
    const { matchId, userId, name, avatar } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/dating/chat?matchId=${matchId}&userId=${userId}&name=${encodeURIComponent(name || '')}&avatar=${encodeURIComponent(avatar || '')}`
    });
  },

  onRetry() {
    this.loadAll();
  },

  onShareAppMessage() {
    return {
      title: 'NK推协 · 我的好友',
      path: '/pages/dating/matches'
    };
  }
});
