const { callCloudFunction } = require('../../utils/request.js');
const format = require('../../utils/format.js');

function formatTime(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value.$date || value);
  if (Number.isNaN(date.getTime())) return '-';
  return format.formatDate(date, 'YYYY-MM-DD HH:mm');
}

function statusText(status) {
  const map = {
    available: 'Available',
    borrowed: 'Borrowed',
    in_transit: 'In transit',
    maintenance: 'Maintenance',
    out_of_stock: 'Unavailable'
  };
  return map[status] || status || 'Unknown';
}

function statusColor(status) {
  const map = {
    available: '#16a085',
    borrowed: '#e74c3c',
    in_transit: '#f39c12',
    maintenance: '#9b59b6',
    out_of_stock: '#95a5a6'
  };
  return map[status] || '#5b6cff';
}

function borrowStatusText(status) {
  const map = {
    applying: 'Applying',
    confirmed: 'Confirmed',
    in_transit: 'In transit',
    borrowed: 'Borrowed',
    returned: 'Returned',
    cancelled: 'Cancelled'
  };
  return map[status] || status || 'Unknown';
}

function normalizeItem(item = {}) {
  const item_id = item.item_id || item._id || '';
  return {
    ...item,
    item_id,
    name: item.name || item.item_name || 'Unnamed item',
    status: item.status || 'available',
    borrow_count: Number(item.borrow_count || 0),
    status_text: statusText(item.status || 'available'),
    status_color: statusColor(item.status || 'available')
  };
}

function normalizeBorrow(record = {}) {
  const application_id = record.application_id || record.borrow_id || record._id || '';
  return {
    ...record,
    application_id,
    item_name: record.item_name || 'Borrow item',
    requested_text: formatTime(record.requested_at || record.created_at),
    lent_text: formatTime(record.lent_at),
    returned_text: formatTime(record.returned_at),
    cancelled_text: formatTime(record.cancelled_at),
    status_text: borrowStatusText(record.status),
    status_color: statusColor(record.status),
    can_cancel: record.status === 'applying' || record.status === 'in_transit'
  };
}

Page({
  data: {
    items: [],
    scripts: [],
    my_borrows: [],
    tab: 'available',
    loading: false,
    error: '',
    refreshing: false,
    selected_item: null,
    show_apply_modal: false,
    apply_reason: '',
    applying: false,
    canceling_id: '',
    scripts_loaded: false,
    scripts_error: ''
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.loadMyBorrows();
    if (this.data.items.length === 0) this.loadItems();
  },

  async initPage() {
    await Promise.all([this.loadItems(), this.loadMyBorrows()]);
  },

  async loadItems() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await callCloudFunction('borrow_getItems', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || 'Load items failed');

      const list = (result.data && result.data.list) || result.data || [];
      this.setData({ items: list.map(normalizeItem) });
    } catch (err) {
      console.error('Load borrow items failed:', err);
      this.setData({ error: err.message || 'Network error' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMyBorrows() {
    try {
      const result = await callCloudFunction('borrow_getBorrowHistory', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || 'Load borrow history failed');

      const list = (result.data && result.data.list) || [];
      this.setData({ my_borrows: list.map(normalizeBorrow) });
    } catch (err) {
      console.error('Load borrow history failed:', err);
    }
  },

  async loadScripts() {
    this.setData({ scripts_error: '' });
    try {
      const result = await callCloudFunction('borrow_getScripts', {
        page: 1,
        page_size: 50
      });
      if (!result.success) throw new Error(result.message || 'Load scripts failed');

      const list = (result.data && result.data.list) || [];
      this.setData({
        scripts: list.map(normalizeItem),
        scripts_loaded: true
      });
    } catch (err) {
      console.error('Load scripts failed:', err);
      this.setData({
        scripts_error: err.message || 'Network error',
        scripts_loaded: true
      });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab === 'scripts' && !this.data.scripts_loaded) this.loadScripts();
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    const tasks = [this.loadItems(), this.loadMyBorrows()];
    if (this.data.tab === 'scripts') tasks.push(this.loadScripts());
    Promise.all(tasks).finally(() => {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    });
  },

  showApplyModal(e) {
    const { item_id, name, status } = e.currentTarget.dataset;
    if (status !== 'available') {
      wx.showToast({ title: 'Unavailable', icon: 'none' });
      return;
    }

    this.setData({
      selected_item: { item_id, name },
      show_apply_modal: true,
      apply_reason: ''
    });
  },

  closeApplyModal() {
    this.setData({ show_apply_modal: false });
  },

  onReasonInput(e) {
    this.setData({ apply_reason: e.detail.value });
  },

  async confirmApply() {
    const { selected_item, apply_reason } = this.data;
    const reason = apply_reason.trim();

    if (!selected_item || !selected_item.item_id) {
      wx.showToast({ title: 'Invalid item', icon: 'none' });
      return;
    }
    if (reason.length < 2) {
      wx.showToast({ title: 'Reason required', icon: 'none' });
      return;
    }

    this.setData({ applying: true });
    try {
      const result = await callCloudFunction('borrow_applyBorrow', {
        item_id: selected_item.item_id,
        reason
      });
      if (!result.success) throw new Error(result.message || 'Apply failed');

      wx.showToast({ title: 'Applied', icon: 'success' });
      this.setData({ show_apply_modal: false });
      await Promise.all([this.loadItems(), this.loadMyBorrows()]);
    } catch (err) {
      wx.showToast({ title: err.message || 'Apply failed', icon: 'none' });
    } finally {
      this.setData({ applying: false });
    }
  },

  showCancelConfirm(e) {
    const { application_id, status } = e.currentTarget.dataset;
    const content = status === 'in_transit'
      ? 'This item is in transit. Cancel this application?'
      : 'Cancel this borrow application?';

    wx.showModal({
      title: 'Cancel borrow',
      content,
      confirmText: 'Confirm',
      cancelText: 'Back',
      success: (res) => {
        if (res.confirm) this.cancelBorrow(application_id);
      }
    });
  },

  async cancelBorrow(application_id) {
    this.setData({ canceling_id: application_id });
    try {
      const result = await callCloudFunction('borrow_cancelBorrow', { application_id });
      if (!result.success) throw new Error(result.message || 'Cancel failed');

      wx.showToast({ title: 'Cancelled', icon: 'success' });
      await Promise.all([this.loadItems(), this.loadMyBorrows()]);
    } catch (err) {
      wx.showToast({ title: err.message || 'Cancel failed', icon: 'none' });
    } finally {
      this.setData({ canceling_id: '' });
    }
  },

  onRetry() {
    this.initPage();
  },

  noop() {}
});
