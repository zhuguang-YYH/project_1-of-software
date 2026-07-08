/**
 * 通用加载组件 - common/loading
 * 显示加载动画和提示
 */

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: '加载中...'
    },
    mask: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    // 显示加载
    show(title) {
      this.setData({
        visible: true,
        title: title || '加载中...'
      });
    },

    // 隐藏加载
    hide() {
      this.setData({
        visible: false
      });
    }
  }
});
