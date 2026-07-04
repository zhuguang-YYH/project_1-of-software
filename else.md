
📋 项目资源缺口清单
🔴 阻塞性缺失（上线前必须补齐）

1. 订阅消息模板 ID — 4 个未配置
   位置: miniprogram/utils/subscribe.js:25-32

COMMISSION_ACCEPTED:  ''   // 委托被领取通知
COMMISSION_REWARD:    ''   // 委托奖励发放通知
BORROW_STATUS_CHANGE: ''   // 借阅状态变更通知
PUZZLE_DAILY_REMINDER: ''  // 每日谜题发布提醒
代码已经完整支持下发（云函数里 sendSubscribeMessage 均已接入），只差去微信公众平台申请模板后把 ID 填进去。不填不影响功能运行，只是用户收不到这 4 类推送。

2. 新增集合缺少安全规则
   database_security_rules.json 缺以下集合的规则：

缺失集合	风险
activity_waitlist	候补名单无规则
game_invitations	游戏邀请无规则
friend_messages	聊天消息无规则
friend_requests	好友请求无规则
notifications	站内通知无规则
banners	轮播图无规则
announcements	公告无规则
代码中已在用这些集合，但安全规则文件没跟上。建议补上，否则云控制台只能用默认权限。

3. 缺少 banners / announcements 种子数据
   recommendation 云函数有 getBanners 和 getAnnouncement 接口，首页 index.js 也在调用，但 init_db 没有初始化这两个集合的数据。首次部署后首页 banner 区为空。

🟡 非阻塞性（阶段性优化）
4. 图片素材未迁移
plan2.md 提到需要把 images/ 目录下的素材迁移到 miniprogram/images/ 对应业务目录。当前状态：

素材	位置	状态
images/2.5/, 2.7/, 2.8/	根目录 images/	❌ 未迁移，含业务分类子目录
排行榜卡片资源	miniprogram/images/rank_card/	✅ 已就位
兑换/借阅图标	miniprogram/images/exchange/, borrow/	✅ 已就位
默认封面/占位图	miniprogram/images/	✅ 已就位
5. 分享裂变 — 缺双方积分发放
TEST_CHECKLIST 提到「邀请链接含 inviter_id → 被邀请人注册后双方获积分」。utils/share.js 已有 rememberInviter，首页 onLoad 也在调用，但邀请注册后发放双方积分的逻辑未实现。

6. 后台 CSV 导出
   plan.md P1-7 提到「反馈、兑换记录、借阅申请支持按状态/时间筛选 + 导出 CSV」。当前后台有查询筛选功能但无 CSV 导出。

📊 优先级建议
优先级	项目	工作量	说明
上线前	#2 安全规则	10分钟	复制现有模板，补充 7 个集合
上线前	#1 订阅消息模板	30分钟	去公众平台申请，填 4 个 ID
首次部署	#3 banner/公告种子数据	15分钟	init_db 补两段 add
后续	#4 图片迁移	1小时	搬文件+替换路径
后续	#5 邀请裂变积分	2小时	新增积分发放逻辑
后续	#6 CSV 导出	2小时	云函数+前端下载
总结：代码逻辑层面已经比较完善（两轮审查下来 bugs 不多）。当前缺口主要在配置层（模板 ID、安全规则）和运营数据层（种子数据、图片素材），这些不涉及复杂的业务逻辑编写。
