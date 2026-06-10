// 订阅消息封装：申请用户授权（wx.requestSubscribeMessage）。
// 实际下发在云函数侧用 cloud.openapi.subscribeMessage.send 完成。
// 注意：必须在用户点击事件的同步调用栈内触发，否则微信会拒绝弹窗。

// 模板 ID（与云函数侧常量保持一致）
const TEMPLATES = {
  // 活动报名成功通知
  REGISTER_SUCCESS: '2SAlGSbn0Ion8Dv94MobCQLf3r2T8P919gbHMMMCCI',
  // 活动开始提醒
  ACTIVITY_REMINDER: 'SJizBGlxHBBon30-DOqXYlOFGHmDHlrA8z_l4a2acjg',
  // 积分兑换通知
  EXCHANGE_NOTIFY: 'd1_r_egCRaHIEqMg3mj-Z32-jli_O11ZjLa-fwhos3c',
  // 委托被领取通知：配置后通知发布者
  COMMISSION_ACCEPTED: '',
  // 委托奖励发放通知：配置后通知领取者
  COMMISSION_REWARD: '',
  // 借阅状态变更通知：配置后通知借阅人
  BORROW_STATUS_CHANGE: '',
  // 每日谜题发布提醒：配置后通知订阅用户
  PUZZLE_DAILY_REMINDER: ''
};

// 申请一组模板的订阅授权。
// 返回 { success, accepted:[tmplId], rejected:[tmplId] }，绝不 reject（用户拒绝/不支持都算正常流程）。
function requestSubscribe(tmplIds) {
  const ids = (Array.isArray(tmplIds) ? tmplIds : [tmplIds]).filter(Boolean).slice(0, 3);
  if (ids.length === 0) return Promise.resolve({ success: true, accepted: [], rejected: [] });

  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.requestSubscribeMessage) {
      resolve({ success: false, accepted: [], rejected: ids, error: '当前环境不支持订阅消息' });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => {
        const accepted = [];
        const rejected = [];
        ids.forEach((id) => {
          (res[id] === 'accept' ? accepted : rejected).push(id);
        });
        resolve({ success: true, accepted, rejected });
      },
      fail: (err) => {
        console.warn('[subscribe] requestSubscribeMessage failed:', err);
        resolve({ success: false, accepted: [], rejected: ids, error: (err && err.errMsg) || '订阅授权失败' });
      }
    });
  });
}

module.exports = {
  TEMPLATES,
  requestSubscribe
};
