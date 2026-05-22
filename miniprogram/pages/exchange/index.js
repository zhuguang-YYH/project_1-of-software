const { callCloudFunction } = require('../../utils/request.js');
const format = require('../../utils/format.js');

function formatTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value.$date || value);
  if (Number.isNaN(date.getTime())) return '';
  return format.formatDate(date, 'YYYY-MM-DD HH:mm');
}

function exchangeStatusText(status) {
  const map = {
    pending: 'Pending',
    shipped: 'Ready',
    completed: 'Completed',
    received: 'Received',
    cancelled: 'Cancelled'
  };
  return map[status] || status || 'Unknown';
}

function exchangeStatusColor(status) {
  const map = {
    pending: '#f39c12',
    shipped: '#3498db',
    completed: '#27ae60',
    received: '#27ae60',
    cancelled: '#95a5a6'
  };
  return map[status] || '#3498db';
}

function normalizeGoods(item = {}, available_points = 0) {
  const item_id = item.item_id || item._id || '';
  const exchange_points = Number(item.exchange_points || 0);
  const available_quantity = Number(item.available_quantity || 0);

  return {
    ...item,
    item_id,
    name: item.name || item.item_name || 'Unnamed goods',
    exchange_points,
    available_quantity,
    max_exchange_quantity: exchange_points > 0
      ? Math.min(available_quantity, Math.floor(available_points / exchange_points))
      : 0,
    is_sold_out: available_quantity <= 0,
    is_affordable: exchange_points > 0 && available_points >= exchange_points
  };
}

function normalizeExchange(record = {}) {
  const exchange_id = record.exchange_id || record._id || '';
  return {
    ...record,
    exchange_id,
    item_name: record.item_name || record.goods_name || 'Exchange goods',
    exchange_time_text: formatTime(record.created_at || record.exchange_time),
    handled_time_text: formatTime(record.handled_at),
    total_points: Number(record.total_points || record.points_cost || 0),
    status_text: exchangeStatusText(record.status),
    status_color: exchangeStatusColor(record.status)
  };
}

Page({
  data: {
    goods: [],
    filtered_goods: [],
    my_exchanges: [],
    user_points: {
      total_points: 0,
      available_points: 0,
      frozen_points: 0
    },
    tab: 'available',
    loading: false,
    error: '',
    refreshing: false,
    selected_goods: null,
    show_exchange_modal: false,
    exchange_quantity: 1,
    selected_total_points: 0,
    exchanging: false,
    search_keyword: ''
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    if (this.data.goods.length === 0) this.loadGoods();
  },

  async initPage() {
    await this.loadUserPoints();
    await Promise.all([this.loadGoods(), this.loadMyExchanges()]);
  },

  async loadUserPoints() {
    try {
      const result = await callCloudFunction('points_getUserPoints', {});
      if (!result.success) throw new Error(result.message || 'Load points failed');

      const data = result.data || {};
      this.setData({
        user_points: {
          total_points: Number(data.total_points || 0),
          available_points: Number(data.available_points || 0),
          frozen_points: Number(data.frozen_points || 0)
        }
      });
    } catch (err) {
      console.error('Load user points failed:', err);
    }
  },

  async loadGoods() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await callCloudFunction('exchange_getGoods', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || 'Load exchange goods failed');

      const list = (result.data && result.data.list) || [];
      const goods = list.map(item => normalizeGoods(item, this.data.user_points.available_points));
      this.setData({
        goods,
        filtered_goods: this.filterGoods(goods, this.data.search_keyword)
      });
    } catch (err) {
      console.error('Load exchange goods failed:', err);
      this.setData({ error: err.message || 'Network error' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMyExchanges() {
    try {
      const result = await callCloudFunction('exchange_getExchangeHistory', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || 'Load exchange history failed');

      const list = (result.data && result.data.list) || [];
      this.setData({ my_exchanges: list.map(normalizeExchange) });
    } catch (err) {
      console.error('Load exchange history failed:', err);
    }
  },

  filterGoods(goods, keyword) {
    const text = String(keyword || '').trim().toLowerCase();
    if (!text) return goods;
    return goods.filter(item =>
      String(item.name || '').toLowerCase().includes(text) ||
      String(item.description || '').toLowerCase().includes(text)
    );
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onSearch(e) {
    const search_keyword = e.detail.value || '';
    this.setData({
      search_keyword,
      filtered_goods: this.filterGoods(this.data.goods, search_keyword)
    });
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.initPage().finally(() => {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    });
  },

  showExchangeModal(e) {
    const item_id = e.currentTarget.dataset.item_id;
    const selected_goods = this.data.goods.find(item => item.item_id === item_id);
    if (!selected_goods) return;

    if (selected_goods.available_quantity <= 0) {
      wx.showToast({ title: 'Sold out', icon: 'none' });
      return;
    }
    if (this.data.user_points.available_points < selected_goods.exchange_points) {
      wx.showToast({ title: 'Points not enough', icon: 'none' });
      return;
    }

    this.setData({
      selected_goods,
      show_exchange_modal: true,
      exchange_quantity: 1,
      selected_total_points: selected_goods.exchange_points
    });
  },

  closeExchangeModal() {
    this.setData({ show_exchange_modal: false });
  },

  onQuantityInput(e) {
    this.setQuantity(parseInt(e.detail.value, 10) || 1);
  },

  changeQuantity(e) {
    const change = Number(e.currentTarget.dataset.change || 0);
    this.setQuantity(this.data.exchange_quantity + change);
  },

  setQuantity(quantity) {
    const selected_goods = this.data.selected_goods;
    if (!selected_goods) return;

    const max = Math.max(1, selected_goods.max_exchange_quantity);
    const exchange_quantity = Math.min(Math.max(1, quantity), max);
    if (quantity > max) {
      wx.showToast({ title: `Max ${max}`, icon: 'none' });
    }
    this.setData({
      exchange_quantity,
      selected_total_points: selected_goods.exchange_points * exchange_quantity
    });
  },

  async confirmExchange() {
    const { selected_goods, exchange_quantity, user_points } = this.data;
    if (!selected_goods) return;

    const total_points = selected_goods.exchange_points * exchange_quantity;
    if (total_points > user_points.available_points) {
      wx.showToast({ title: 'Points not enough', icon: 'none' });
      return;
    }

    this.setData({ exchanging: true });
    try {
      const result = await callCloudFunction('exchange_doExchange', {
        item_id: selected_goods.item_id,
        quantity: exchange_quantity
      });
      if (!result.success) throw new Error(result.message || 'Exchange failed');

      wx.showToast({ title: 'Exchanged', icon: 'success' });
      this.setData({ show_exchange_modal: false });
      await this.initPage();
    } catch (err) {
      wx.showToast({ title: err.message || 'Exchange failed', icon: 'none' });
    } finally {
      this.setData({ exchanging: false });
    }
  },

  onRetry() {
    this.initPage();
  },

  noop() {}
});
