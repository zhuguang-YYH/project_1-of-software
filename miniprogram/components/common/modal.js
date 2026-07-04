/**
 * 通用弹窗组件 - common/modal
 * 提示、确认对话框
 */

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: '提示'
    },
    content: {
      type: String,
      value: ''
    },
    confirmText: {
      type: String,
      value: '确定'
    },
    cancelText: {
      type: String,
      value: '取消'
    },
    showCancel: {
      type: Boolean,
      value: true
    },
    confirmColor: {
      type: String,
      value: '#5b6cff'
    },
    theme: {
      type: String,
      value: 'blue'
    }
  },

  methods: {
    // 确认
    handleConfirm() {
      this.triggerEvent('confirm');
      this.hide();
    },

    // 取消
    handleCancel() {
      this.triggerEvent('cancel');
      this.hide();
    },

    // 显示弹窗
    show(options) {
      this.setData({
        visible: true,
        title: options.title || this.data.title,
        content: options.content || this.data.content,
        confirmText: options.confirmText || this.data.confirmText,
        cancelText: options.cancelText || this.data.cancelText,
        showCancel: options.showCancel !== undefined ? options.showCancel : this.data.showCancel,
        theme: options.theme || this.data.theme
      });
    },

    // 隐藏弹窗
    hide() {
      this.setData({
        visible: false
      });
    }
  }
});
