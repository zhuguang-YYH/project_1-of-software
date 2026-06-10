Component({
  properties: {
    rows: {
      type: Number,
      value: 3,
      observer: 'buildRows'
    },
    variant: {
      type: String,
      value: 'card'
    },
    title: {
      type: String,
      value: ''
    }
  },

  data: {
    rowList: [0, 1, 2]
  },

  lifetimes: {
    attached() {
      this.buildRows(this.data.rows);
    }
  },

  methods: {
    buildRows(value) {
      const count = Math.min(6, Math.max(1, Number(value) || 3));
      this.setData({
        rowList: Array.from({ length: count }, (_, index) => index)
      });
    }
  }
});
