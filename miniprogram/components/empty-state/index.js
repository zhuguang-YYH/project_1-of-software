Component({
  options: { multipleSlots: true },
  properties: {
    icon: { type: String, value: '?' },
    title: { type: String, value: '暂无数据' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
    variant: { type: String, value: 'default' }
  },
  methods: {
    onAction() {
      this.triggerEvent('action');
    }
  }
});
