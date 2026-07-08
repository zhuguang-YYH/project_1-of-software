const datingService = require('../../services/dating.js');
const { applyTheme } = require('../../utils/theme.js');

const GAME_TYPE_ICONS = {
  script_kill: '🎭',
  board_game: '🎲',
  puzzle: '🧩',
  activity: '🎪',
  other: '🎯'
};

Page({
  data: {
    profiles: [],
    loading: true,
    error: '',
    theme: 'blue',
    // 每日状态
    remaining_swipes: 0,
    daily_limit: 20,
    is_in_pool: false,
    preferences: null,
    // 偏好编辑弹窗
    show_prefs_modal: false,
    edit_visibility: true,
    edit_tags: [],
    tag_input: '',
    edit_campus_pref: 'any',
    edit_grade_pref: 'any',
    // 匹配成功弹窗
    show_match_modal: false,
    matched_user: null,
    // 动画
    swiping_card_id: '',
    swipe_direction: ''
  },

  onLoad() {
    this.loadTheme();
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    if (this._initialized) {
      this.refreshStatus();
    }
  },

  loadTheme() {
    applyTheme(this);
  },

  async initPage() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadDailyStatus(),
        this.loadProfiles()
      ]);
      this._initialized = true;
    } catch (err) {
      console.error('Failed to init dating discover:', err);
      this.setData({ error: err.message || '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async refreshStatus() {
    try {
      await this.loadDailyStatus();
    } catch (_) { /* ignore */ }
  },

  async loadDailyStatus() {
    try {
      const result = await datingService.getDailyStatus();
      if (result.success && result.data) {
        const d = result.data;
        this.setData({
          remaining_swipes: d.remaining_swipes || 0,
          daily_limit: d.daily_limit || 20,
          is_in_pool: d.is_in_pool || false,
          preferences: d.preferences || null
        });
      }
    } catch (err) {
      console.error('Failed to load daily status:', err);
    }
  },

  async loadProfiles() {
    try {
      const result = await datingService.getProfiles();
      if (!result.success) {
        this.setData({ error: result.error || '加载推荐失败' });
        return;
      }

      const data = result.data || {};
      const profiles = (data.profiles || []).map(p => ({
        user_id: p.user_id,
        display_name: p.display_name || '神秘侦探',
        avatar_url: p.avatar_url || '',
        campus: p.campus || '未知校区',
        grade: p.grade || '未知年级',
        interests: p.interests || [],
        self_intro: p.self_intro || '',
        puzzle_correct_rate: p.puzzle_correct_rate || 50,
        shared_interests: p.shared_interests || [],
        _animating: false
      }));

      this.setData({
        profiles,
        remaining_swipes: data.remaining_swipes != null ? data.remaining_swipes : this.data.remaining_swipes,
        error: profiles.length === 0 ? '' : this.data.error
      });
    } catch (err) {
      console.error('Failed to load profiles:', err);
      this.setData({ error: err.message || '加载推荐失败' });
    }
  },

  // ========== 滑动操作 ==========

  async doSwipe(e) {
    const { userId, action } = e.currentTarget.dataset;
    if (!userId || !action) return;
    if (this.data.remaining_swipes <= 0 && action === 'like') {
      wx.showToast({ title: '今日浏览已达上限', icon: 'none' });
      return;
    }

    const card = this.data.profiles.find(p => p.user_id === userId);
    if (!card || card._animating) return;

    // 播放滑出动画
    const direction = action === 'like' ? 'right' : 'left';
    this.setData({
      swiping_card_id: userId,
      swipe_direction: direction
    });

    // 标记动画中
    const animProfiles = this.data.profiles.map(p => {
      if (p.user_id === userId) return { ...p, _animating: true };
      return p;
    });
    this.setData({ profiles: animProfiles });

    try {
      const result = await datingService.swipe(userId, action);
      if (!result.success) {
        wx.showToast({ title: result.error || '操作失败', icon: 'none' });
        // 恢复
        const restored = this.data.profiles.map(p => {
          if (p.user_id === userId) return { ...p, _animating: false };
          return p;
        });
        this.setData({
          profiles: restored,
          swiping_card_id: '',
          swipe_direction: ''
        });
        return;
      }

      const respData = result.data || {};

      // 处理匹配成功
      if (respData.match_created && respData.match) {
        this.setData({
          show_match_modal: true,
          matched_user: {
            user_id: respData.match.matched_user_id,
            display_name: respData.match.matched_user_name || '神秘侦探',
            match_id: respData.match.match_id
          }
        });
      }

      // 移除已滑动的卡片
      setTimeout(() => {
        const remaining = this.data.profiles.filter(p => p.user_id !== userId);
        this.setData({
          profiles: remaining,
          remaining_swipes: respData.remaining_swipes != null ? respData.remaining_swipes : this.data.remaining_swipes - 1,
          swiping_card_id: '',
          swipe_direction: ''
        });

        // 卡片不足时自动加载更多
        if (remaining.length <= 1) {
          this.loadProfiles();
        }
      }, 350);

    } catch (err) {
      console.error('Swipe failed:', err);
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      const restored = this.data.profiles.map(p => {
        if (p.user_id === userId) return { ...p, _animating: false };
        return p;
      });
      this.setData({
        profiles: restored,
        swiping_card_id: '',
        swipe_direction: ''
      });
    }
  },

  // ========== 匹配成功弹窗 ==========

  closeMatchModal() {
    this.setData({ show_match_modal: false, matched_user: null });
  },

  goToChatFromMatch() {
    const m = this.data.matched_user;
    if (!m) return;
    this.setData({ show_match_modal: false, matched_user: null });
    wx.navigateTo({
      url: `/pages/dating/chat?matchId=${m.match_id}&userId=${m.user_id}&name=${encodeURIComponent(m.display_name)}`
    });
  },

  // ========== 交友池 ==========

  async togglePool() {
    try {
      if (this.data.is_in_pool) {
        const result = await datingService.leavePool();
        if (result.success) {
          this.setData({ is_in_pool: false });
          wx.showToast({ title: '已退出交友池', icon: 'success' });
        } else {
          wx.showToast({ title: result.error || '操作失败', icon: 'none' });
        }
      } else {
        const result = await datingService.joinPool();
        if (result.success) {
          this.setData({ is_in_pool: true });
          wx.showToast({ title: '已加入交友池', icon: 'success' });
          this.loadProfiles();
        } else {
          wx.showToast({ title: result.error || '操作失败', icon: 'none' });
        }
      }
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  // ========== 偏好设置 ==========

  openPreferences() {
    const prefs = this.data.preferences || {};
    this.setData({
      show_prefs_modal: true,
      edit_visibility: prefs.dating_visibility !== false,
      edit_tags: prefs.interested_tags || [],
      tag_input: '',
      edit_campus_pref: prefs.campus_preference || 'any',
      edit_grade_pref: prefs.grade_preference || 'any'
    });
  },

  closePreferences() {
    this.setData({ show_prefs_modal: false });
  },

  onTagInput(e) {
    this.setData({ tag_input: e.detail.value });
  },

  addTag() {
    const tag = this.data.tag_input.trim();
    if (!tag) return;
    if (this.data.edit_tags.includes(tag)) {
      wx.showToast({ title: '标签已存在', icon: 'none' });
      return;
    }
    if (this.data.edit_tags.length >= 8) {
      wx.showToast({ title: '最多添加8个标签', icon: 'none' });
      return;
    }
    this.setData({
      edit_tags: [...this.data.edit_tags, tag],
      tag_input: ''
    });
  },

  removeTag(e) {
    const idx = e.currentTarget.dataset.index;
    const tags = [...this.data.edit_tags];
    tags.splice(idx, 1);
    this.setData({ edit_tags: tags });
  },

  toggleVisibility() {
    this.setData({ edit_visibility: !this.data.edit_visibility });
  },

  selectCampusPref(e) {
    this.setData({ edit_campus_pref: e.currentTarget.dataset.value });
  },

  selectGradePref(e) {
    this.setData({ edit_grade_pref: e.currentTarget.dataset.value });
  },

  async savePreferences() {
    try {
      const result = await datingService.updatePreferences({
        dating_visibility: this.data.edit_visibility,
        interested_tags: this.data.edit_tags,
        campus_preference: this.data.edit_campus_pref,
        grade_preference: this.data.edit_grade_pref
      });

      if (result.success) {
        this.setData({
          show_prefs_modal: false,
          preferences: {
            dating_visibility: this.data.edit_visibility,
            interested_tags: this.data.edit_tags,
            campus_preference: this.data.edit_campus_pref,
            grade_preference: this.data.edit_grade_pref
          }
        });
        wx.showToast({ title: '偏好已更新', icon: 'success' });
      } else {
        wx.showToast({ title: result.error || '更新失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message || '更新失败', icon: 'none' });
    }
  },

  // ========== 导航 ==========

  goToMatches() {
    wx.navigateTo({ url: '/pages/dating/matches' });
  },

  // ========== 生命周期 ==========

  onRetry() {
    this.initPage();
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([
        this.loadDailyStatus(),
        this.loadProfiles()
      ]);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onShareAppMessage() {
    return {
      title: 'NK推协 · 推理交友',
      path: '/pages/dating/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 推理交友'
    };
  },

  // 占位函数 — WXML 中 catchtouchmove 引用
  noop() {}
});
