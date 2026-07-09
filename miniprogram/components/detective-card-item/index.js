Component({
  properties: {
    user: {
      type: Object,
      value: {}
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

  methods: {
    handleTap() {
      const user = this.properties.user || {};
      this.triggerEvent('cardtap', {
        user_id: user.user_id || '',
        user
      });
    },

    onAvatarError() {
      this.setData({
        'user.avatar_url': '/images/icons/avatar.png'
      });
    }
  }
});
