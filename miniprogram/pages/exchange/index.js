const exchangeService = require('../../services/exchange.js');
const pointsService = require('../../services/points.js');
const subscribe = require('../../utils/subscribe.js');
const format = require('../../utils/format.js');
const { applyTheme } = require('../../utils/theme.js');

const EXCHANGE_ASSETS = {
  goodsDefault: '/pages/exchange/images/goods-default.jpg',
  pointsCoin: '/pages/exchange/images/points-coin.jpg',
  stockEmpty: '/pages/exchange/images/stock-empty.jpg'
};

function formatTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value.$date || value);
  if (Number.isNaN(date.getTime())) return '';
  return format.formatDate(date, 'YYYY-MM-DD HH:mm');
}

function exchangeStatusText(status) {
  const map = {
    processing: '处理中',
    pending: '处理中',
    shipped: '待领取',
    completed: '已完成',
    received: '已领取',
    cancelled: '已取消',
    failed: '兑换失败'
  };
  return map[status] || status || '未知';
}

function exchangeStatusColor(status) {
  const map = {
    processing: '#f39c12',
    pending: '#f39c12',
    shipped: '#5b6cff',
    completed: '#16a085',
    received: '#16a085',
    cancelled: '#95a5a6',
    failed: '#e74c3c'
  };
  return map[status] || '#5b6cff';
}

function normalizeGoods(item = {}, available_points = 0) {
  const item_id = item.item_id || item._id || '';
  const exchange_points = Number(item.exchange_points || 0);
  const available_quantity = Number(item.available_quantity || 0);

  return {
    ...item,
    item_id,
    name: item.name || item.item_name || '未命名商品',
    cover_url: item.cover_url || item.image_url || item.image || EXCHANGE_ASSETS.goodsDefault,
    points_icon: EXCHANGE_ASSETS.pointsCoin,
    stock_icon: EXCHANGE_ASSETS.stockEmpty,
    exchange_points,
    available_quantity,
    max_exchange_quantity: exchange_points > 0
      ? Math.min(available_quantity, Math.floor(available_points / exchange_points))
      : 0,
    is_sold_out: available_quantity <= 0,
    is_affordable: exchange_points > 0 && available_points >= exchange_points,
    short_points: Math.max(0, exchange_points - available_points)
  };
}

function normalizeExchange(record = {}) {
  const exchange_id = record.exchange_id || record._id || '';
  return {
    ...record,
    exchange_id,
    item_name: record.item_name || record.goods_name || '兑换商品',
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
    theme: 'blue',
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
    this.loadTheme();
    this.initPage();
  },

  onShow() {
    this.loadTheme();
    this.loadUserPoints();
    this.loadMyExchanges();
    if (this.data.goods.length === 0) this.loadGoods();
  },

  loadTheme() {
    applyTheme(this);
  },

  async initPage() {
    await this.loadUserPoints();
    await Promise.all([this.loadGoods(), this.loadMyExchanges()]);
  },

  async loadUserPoints() {
    try {
      const result = await pointsService.getUserPoints();
      if (!result.success) throw new Error('Load points failed');

      this.setData({
        user_points: {
          total_points: Number(result.total_points || 0),
          available_points: Number(result.available_points || 0),
          frozen_points: Number(result.frozen_points || 0)
        }
      });
    } catch (err) {
      console.error('Load user points failed:', err);
    }
  },

  async loadGoods() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await exchangeService.getProducts({
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.error || 'Load exchange goods failed');

      const list = result.data || [];
      const goods = list.map(item => normalizeGoods(item, this.data.user_points.available_points));
      this.setData({
        goods,
        filtered_goods: this.filterGoods(goods, this.data.search_keyword)
      });
    } catch (err) {
      console.error('Load exchange goods failed:', err);
      this.setData({ error: err.message || '网络异常' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMyExchanges() {
    try {
      const result = await exchangeService.getExchangeHistory({
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.error || 'Load exchange history failed');

      const list = result.data || [];
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
      wx.showToast({ title: '商品已兑完', icon: 'none' });
      return;
    }
    if (this.data.user_points.available_points < selected_goods.exchange_points) {
      wx.showToast({ title: '积分不足', icon: 'none' });
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
      wx.showToast({ title: `最多兑换 ${max} 件`, icon: 'none' });
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
      wx.showToast({ title: '积分不足', icon: 'none' });
      return;
    }

    // 申请兑换通知订阅授权；须在点击手势栈内触发，用户拒绝不影响兑换
    await subscribe.requestSubscribe(subscribe.TEMPLATES.EXCHANGE_NOTIFY);

    this.setData({ exchanging: true });
    try {
      const result = await exchangeService.exchange(
        selected_goods.item_id,
        exchange_quantity
      );
      if (!result.success) throw new Error(result.error || '兑换失败');

      wx.showToast({ title: '兑换成功', icon: 'success' });
      this.setData({ show_exchange_modal: false });
      await this.initPage();
    } catch (err) {
      wx.showToast({ title: err.message || '兑换失败', icon: 'none' });
    } finally {
      this.setData({ exchanging: false });
    }
  },

  onRetry() {
    this.initPage();
  },

  onShareAppMessage() {
    return {
      title: 'NK推协 · 积分兑换',
      path: '/pages/exchange/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'NK推协 · 积分兑换'
    };
  },

  noop() {}
});
