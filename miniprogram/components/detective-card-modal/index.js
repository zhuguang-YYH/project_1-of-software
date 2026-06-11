Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    loading: {
      type: Boolean,
      value: false
    },
    card: {
      type: Object,
      value: null
    },
    theme: {
      type: String,
      value: 'blue'
    }
  },

  methods: {
    close() {
      this.triggerEvent('close');
    },

    noop() {}
  }
});
