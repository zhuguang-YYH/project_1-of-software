const { storage } = require('../../utils/storage');
const { auth } = require('../../utils/auth');
const upload = require('../../utils/upload');
const userService = require('../../services/user');
const profileService = require('../../services/profile');
const rankingService = require('../../services/ranking');
const { applyTheme, setTheme } = require('../../utils/theme.js');

function isDefaultName(name) {
  return !name || ['未知用户', '未设置昵称'].includes(String(name).trim());
}

function normalizeInterests(interests) {
  if (Array.isArray(interests)) return interests;
  return String(interests || '').split(/[,，、\s]+/).map(item => item.trim()).filter(Boolean);
}

function isProfileIncomplete(userInfo) {
  if (!userInfo) return true;
  return isDefaultName(userInfo.nickname) || !userInfo.avatar_url;
}

Page({
  data: {
    userInfo: null,
    userIdShort: '...',
    card: null,
    myPoints: 0,
    myRank: 0,
    theme: 'blue',
    loading: true,
    editMode: false,
    savingProfile: false,
    profileIncomplete: false,
    interestList: [],
    form: {
      nickname: '',
      avatar_url: '',
      signature: '',
      interests: '',
      student_id: ''
    }
  },

  onLoad() {
    this.profileLoaded = false;
    this.loadTheme();
    this.loadProfile();
  },

  onShow() {
    this.loadTheme();
    if (this.profileLoaded) this.loadProfile();
  },

  loadTheme() {
    applyTheme(this);
  },

  async loadProfile() {
    this.setData({ loading: true });

    try {
      let userInfo = storage.getUserInfo();

      if (!userInfo || !userInfo.user_id) {
        const loginResult = await auth.wxLogin();
        userInfo = loginResult && loginResult.success ? loginResult.data.userInfo : null;
      } else {
        const refreshResult = await userService.getUserInfo();
        if (refreshResult.success && refreshResult.data) {
          userInfo = refreshResult.data;
          storage.setUserInfo(userInfo);
        }
      }

      if (!userInfo) {
        this.setData({
          userInfo: null,
          profileIncomplete: true,
          loading: false
        });
        return;
      }

      this.setData({ userInfo, userIdShort: (userInfo.user_id || '').slice(-8) || '...' });

      await Promise.all([
        this.loadCard(),
        this.loadMyPoints(),
        this.loadMyRanking()
      ]);

      this.setData({
        userInfo,
        userIdShort: (userInfo.user_id || '').slice(-8) || '...',
        profileIncomplete: isProfileIncomplete(userInfo),
        form: this.buildForm(userInfo),
        interestList: this.buildInterestList(userInfo)
      });
    } catch (err) {
      console.error('Load profile failed:', err);
      wx.showToast({ title: err.message || '个人中心加载失败', icon: 'none' });
    } finally {
      this.profileLoaded = true;
      this.setData({ loading: false });
    }
  },

  buildForm(userInfo) {
    return {
      nickname: isDefaultName(userInfo.nickname) ? '' : (userInfo.nickname || ''),
      avatar_url: userInfo.avatar_url || '',
      signature: userInfo.signature || '',
      interests: normalizeInterests(userInfo.interests).join('、'),
      student_id: userInfo.student_id || ''
    };
  },

  buildInterestList(userInfo) {
    return normalizeInterests(userInfo && userInfo.interests);
  },

  async loadCard() {
    try {
      const result = await profileService.getCard();
      if (result.success) this.setData({ card: result.data || null });
    } catch (err) {
      console.error('Load card failed:', err);
    }
  },

  async loadMyPoints() {
    try {
      const result = await profileService.getMyPoints();
      if (result.success) {
        this.setData({ myPoints: Number(result.data.available_points || 0) });
      }
    } catch (err) {
      console.error('Load points failed:', err);
    }
  },

  async loadMyRanking() {
    try {
      const result = await rankingService.getUserRanking();
      if (result.success) {
        this.setData({ myRank: Number(result.data.rank_no || 101) });
      }
    } catch (err) {
      console.error('Load ranking failed:', err);
    }
  },

  startEdit() {
    this.setData({
      editMode: true,
      form: this.buildForm(this.data.userInfo || {})
    });
  },

  cancelEdit() {
    this.setData({ editMode: false });
  },

  async loginAndEdit() {
    try {
      this.setData({ loading: true });
      const result = await auth.wxLogin();
      if (!result.success) throw new Error(result.message || '登录失败');

      const userInfo = result.data.userInfo;
      this.setData({
        userInfo,
        userIdShort: (userInfo.user_id || '').slice(-8) || '...',
        profileIncomplete: isProfileIncomplete(userInfo),
        loading: false,
        form: this.buildForm(userInfo),
        interestList: this.buildInterestList(userInfo)
      });
      this.startEdit();
    } catch (err) {
      console.error('Login failed:', err);
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '登录失败', icon: 'none' });
    }
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;
    this.setData({
      form: {
        ...this.data.form,
        avatar_url: avatarUrl
      }
    });
  },

  async uploadAvatarIfNeeded(avatarUrl) {
    if (!upload.isLocalTempPath(avatarUrl)) return avatarUrl;

    const userInfo = this.data.userInfo || storage.getUserInfo() || {};
    const result = await upload.uploadToCloud(avatarUrl, {
      dir: 'avatars',
      owner: userInfo.user_id || 'user'
    });
    // 上传失败时抛出，由 saveEdit 统一提示并中断保存，避免误存本地临时路径
    if (!result.success) throw new Error(result.error || '头像上传失败');
    return result.fileID;
  },

  async saveEdit() {
    const nickname = (this.data.form.nickname || '').trim();
    const rawAvatarUrl = this.data.form.avatar_url || '';
    const signature = (this.data.form.signature || '').trim();
    const interests = normalizeInterests(this.data.form.interests);
    const student_id = (this.data.form.student_id || '').trim();

    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }

    if (student_id && !/^\d{4,20}$/.test(student_id)) {
      wx.showToast({ title: '学号需为 4-20 位数字', icon: 'none' });
      return;
    }

    try {
      this.setData({ savingProfile: true });
      const avatarUrl = await this.uploadAvatarIfNeeded(rawAvatarUrl);
      const result = await userService.updateProfile({
        nickname,
        avatar_url: avatarUrl,
        signature,
        interests,
        student_id
      });

      if (!result.success) throw new Error(result.message || '保存失败');

      const userInfo = {
        ...(result.data || {}),
        user_id: (result.data && result.data.user_id) || (this.data.userInfo && this.data.userInfo.user_id),
        nickname,
        avatar_url: avatarUrl,
        signature,
        interests,
        student_id
      };
      storage.setUserInfo(userInfo);

      const app = getApp();
      if (app && app.globalData) {
        app.globalData.userInfo = userInfo;
        app.globalData.isLoggedIn = true;
      }

      this.setData({
        userInfo,
        editMode: false,
        profileIncomplete: isProfileIncomplete(userInfo),
        form: this.buildForm(userInfo),
        interestList: this.buildInterestList(userInfo)
      });
      await this.loadCard();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      console.error('Save profile failed:', err);
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingProfile: false });
    }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({
      form: {
        ...this.data.form,
        [field]: e.detail.value
      }
    });
  },

  goToActivity() {
    wx.navigateTo({ url: '/pages/activity/index' });
  },

  goBorrow() {
    wx.navigateTo({ url: '/pages/borrow/index' });
  },

  goExchange() {
    wx.navigateTo({ url: '/pages/exchange/index' });
  },

  goPoints() {
    wx.navigateTo({ url: '/pages/points/index' });
  },

  goCommission() {
    wx.navigateTo({ url: '/pages/commission/index' });
  },

  goNotifications() {
    wx.navigateTo({ url: '/pages/notifications/index' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  switchTheme(e) {
    const theme = e.currentTarget.dataset.theme === 'gold' ? 'gold' : 'blue';
    if (theme === this.data.theme) return;

    setTheme(theme);
    this.loadTheme();
    wx.showToast({
      title: theme === 'gold' ? '已切换黑金' : '已切换侦探蓝',
      icon: 'none'
    });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/index' });
  }
});
