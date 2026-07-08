// 订阅消息封装：只负责在用户点击事件中申请授权。
// 实际下发由云函数侧通过 cloud.openapi.subscribeMessage.send 完成。
//
// 当前微信公众平台已配置的模板：
// - 活动报名成功通知
// - 活动开始提醒
// - 积分兑换通知
//
// 已补充的运营模板：
// - 任务交付通知：通知委托发布者，作为“委托被领取通知”
// - 任务验收通知：通知委托领取者，作为“委托奖励发放通知”
// - 商品状态变更通知：通知借阅人，作为“借阅状态变更通知”
// - 问题被回复通知：通知订阅用户，作为“每日谜题发布提醒”

const TEMPLATES = {
  REGISTER_SUCCESS: '2SAlGSbn0Ion8Dv94MobCQLf3r2T8P919gbHMMMCCI',
  ACTIVITY_REMINDER: 'SJizBGlxHBBon30-DOqXYlOFGHmDHlrA8z_l4a2acjg',
  EXCHANGE_NOTIFY: 'd1_r_egCRaHIEqMg3mj-Z32-jli_O11ZjLa-fwhos3c',

  COMMISSION_ACCEPTED: 'W3lL_tFjTwrKtRwjX3cTVHo4SGh-JDNE1JwjDm4G50E',
  COMMISSION_REWARD: '5tWnGXcV42BnT2YI2FZ7OOBoZV28EeU-nBgTIH6IBZY',
  BORROW_STATUS_CHANGE: 'LFk_O5Rv1K4u68Xv7YcsNnKks5OH-ICd1HZ10vrYMzc',
  PUZZLE_DAILY_REMINDER: '2FmECqS9gnBrJTtaj8aeMtap6eIC-axy3Es7BxdIa08'
};

function requestSubscribe(tmplIds) {
  const ids = (Array.isArray(tmplIds) ? tmplIds : [tmplIds]).filter(Boolean).slice(0, 3);
  if (ids.length === 0) return Promise.resolve({ success: true, accepted: [], rejected: [] });

  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.requestSubscribeMessage) {
      resolve({
        success: false,
        accepted: [],
        rejected: ids,
        error: '当前环境不支持订阅消息'
      });
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
        resolve({
          success: false,
          accepted: [],
          rejected: ids,
          error: (err && err.errMsg) || '订阅授权失败'
        });
      }
    });
  });
}

module.exports = {
  TEMPLATES,
  requestSubscribe
};
