// 订阅消息封装：申请用户授权（wx.requestSubscribeMessage）。
// 实际下发在云函数侧用 cloud.openapi.subscribeMessage.send 完成。
// 注意：必须在用户点击事件的同步调用栈内触发，否则微信会拒绝弹窗。
//
// 模板 ID 配置说明：
// 1. 登录微信公众平台 → 功能 → 订阅消息
// 2. 在公共模板库中搜索对应模板关键词，添加到我的模板
// 3. 将获取的模板 ID 填入下方的 TEMPLATES 对象
// 4. 同步更新各云函数的环境变量（如 COMMISSION_ACCEPTED_TMPL 等）
// 5. 已配置的模板：活动报名成功、活动开始提醒、积分兑换通知
// 6. 待配置的模板（需先在公众平台添加后填入 ID）：
//    - 委托被领取通知：搜索"服务进度通知"类模板，通知委托发布者
//    - 委托奖励发放通知：搜索"奖励发放"类模板，通知委托领取者
//    - 借阅状态变更通知：搜索"借阅状态"类模板，通知借阅人确认借出/归还
//    - 每日谜题发布提醒：搜索"日程提醒"类模板，订阅用户每日推送

// 模板 ID（与云函数侧常量保持一致）
const TEMPLATES = {
  // ✅ 已配置：活动报名成功通知
  REGISTER_SUCCESS: '2SAlGSbn0Ion8Dv94MobCQLf3r2T8P919gbHMMMCCI',
  // ✅ 已配置：活动开始提醒
  ACTIVITY_REMINDER: 'SJizBGlxHBBon30-DOqXYlOFGHmDHlrA8z_l4a2acjg',
  // ✅ 已配置：积分兑换通知
  EXCHANGE_NOTIFY: 'd1_r_egCRaHIEqMg3mj-Z32-jli_O11ZjLa-fwhos3c',
  // ⏳ 待配置：委托被领取通知 → 通知发布者（需在公众平台添加后填入 ID）
  COMMISSION_ACCEPTED: '',
  // ⏳ 待配置：委托奖励发放通知 → 通知领取者（需在公众平台添加后填入 ID）
  COMMISSION_REWARD: '',
  // ⏳ 待配置：借阅状态变更通知 → 通知借阅人（需在公众平台添加后填入 ID）
  BORROW_STATUS_CHANGE: '',
  // ⏳ 待配置：每日谜题发布提醒 → 通知订阅用户（需在公众平台添加后填入 ID）
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
