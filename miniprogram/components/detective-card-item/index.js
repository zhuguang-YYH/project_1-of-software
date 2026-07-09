const { DEFAULT_AVATAR, normalizeAvatarUrl, resolveCloudAvatarUrl } = require('../../utils/avatar.js');

Component({
  properties: {
    user: {
      type: Object,
      value: {},
      observer(user) {
        this.resolveAvatar(user);
      }
    },
    variant: {
      type: String,
      value: 'list'
    },
    theme: {
      type: String,
      value: 'light'
    },
    a11yFontClass: {
      type: String,
      value: ''
    },
    showRank: {
      type: Boolean,
      value: true
    },
    showScore: {
      type: Boolean,
      value: true
    },
    meta: {
      type: String,
      value: ''
    }
  },

  data: {
    displayAvatar: DEFAULT_AVATAR
  },

  lifetimes: {
    attached() {
      this.resolveAvatar(this.properties.user);
    }
  },

  methods: {
    async resolveAvatar(user = {}) {
      const avatar_url = normalizeAvatarUrl(user.avatar_url);
      if (!avatar_url) {
        this.setData({ displayAvatar: DEFAULT_AVATAR });
        return;
      }

      const displayAvatar = await resolveCloudAvatarUrl(avatar_url);
      this.setData({ displayAvatar: displayAvatar || DEFAULT_AVATAR });
    },

    handleTap() {
      const user = this.properties.user || {};
      this.triggerEvent('cardtap', {
        user_id: user.user_id || '',
        user
      });
    },

    onAvatarError() {
      this.setData({
        displayAvatar: DEFAULT_AVATAR
      });
    }
  }
});
