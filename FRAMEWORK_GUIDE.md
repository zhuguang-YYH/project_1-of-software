// 项目说明和框架结构文档
# NK推协侦探管理系统 - 微信小程序框架

## 项目结构说明

```
miniprogram/
├── config/              # 全局配置
│   └── index.js         # 配置管理（API、常量、状态枚举）
├── utils/               # 工具函数库
│   ├── request.js       # 网络请求封装（支持云函数、HTTP）
│   ├── storage.js       # 本地存储封装
│   ├── auth.js          # 身份认证和权限管理
│   ├── format.js        # 数据格式化工具
│   └── validate.js      # 数据验证工具
├── services/            # 业务服务层
│   ├── puzzle.js        # 每日谜题服务
│   ├── ranking.js       # 排行榜服务
│   ├── points.js        # 积分管理服务
│   ├── borrow.js        # 物资借阅服务
│   └── activity.js      # 活动管理服务
├── components/
│   └── common/          # 通用组件库
│       ├── loading/     # 加载组件
│       └── modal/       # 弹窗组件
├── styles/              # 全局样式
│   └── common.wxss      # 通用样式定义
├── constants/           # 常量定义（预留）
├── models/              # 数据模型（预留）
├── pages/               # 页面模块（待完成）
│   ├── puzzle/          # 每日谜题页面
│   ├── ranking/         # 排行榜页面
│   ├── borrow/          # 物资借阅页面
│   ├── activity/        # 活动报名页面
│   ├── exchange/        # 积分兑换页面
│   ├── dud/             # Dud聊天页面
│   ├── commission/      # 事件委托页面
│   ├── profile/         # 个人主页页面
│   ├── admin/           # 管理后台页面
│   ├── index/           # 首页
│   └── example/         # 示例页面
├── app.js               # 全局App文件
├── app.json             # App配置
├── app.wxss             # App全局样式
├── envList.js           # 环境变量列表
└── sitemap.json         # 小程序地图文件

cloudfunctions/
├── quickstartFunctions/
├── common/              # 通用云函数（预留）
└── ...                  # 各业务模块云函数
```

## 核心特性

### 1. 工具函数库（utils/）

✅ **request.js** - 网络请求封装
- 云函数调用接口
- HTTP请求支持
- 超时控制（1.5-2秒内）
- 自动重试机制
- 统一错误处理

✅ **storage.js** - 本地存储
- 同步和异步存储API
- 过期时间管理
- Token和用户信息管理

✅ **auth.js** - 身份认证
- 微信登录（OpenID）
- Token管理和刷新
- 权限检查
- 用户信息缓存

✅ **format.js** - 数据格式化
- 日期、时间、相对时间格式化
- 数字、文件大小格式化
- 积分、排名、状态格式化
- HTML转义和文本截断

✅ **validate.js** - 数据验证
- 类型检查（邮箱、电话、URL等）
- 长度验证
- 日期验证
- 批量字段验证
- 密码强度检查

### 2. 业务服务层（services/）

✅ **puzzle.js** - 每日谜题服务
- 获取今日谜题
- 提交答题
- 查询答题历史和统计
- 防重复提交

✅ **ranking.js** - 排行榜服务
- 获取前三名/完整排行榜
- 用户排名查询
- 排行榜缓存优化
- 同分用户处理

✅ **points.js** - 积分管理服务
- 获取用户积分（总积分、可兑换、冻结）
- 积分流水查询
- 积分冻结/解冻（用于委托）
- 积分足额检查

✅ **borrow.js** - 物资借阅服务
- 获取可借阅物品
- 申请借阅/取消
- 借阅历史查询
- 剧本杀列表
- 物品传递中状态处理

✅ **activity.js** - 活动管理服务
- 获取活动列表
- 活动报名/取消
- 取消时间限制检查
- 报名人数上限检查
- 我的活动查询

### 3. 通用组件（components/common/）

✅ **loading** - 加载动画组件
✅ **modal** - 弹窗组件（确认、提示）

### 4. 全局配置（config/index.js）

- 云函数名称统一管理
- API端点定义
- 业务常量（并发、积分等）
- 错误代码枚举
- 状态枚举（借阅、兑换、活动、委托等）
- 缓存和超时配置

### 5. 全局样式（styles/common.wxss）

- CSS变量系统
- 响应式布局工具类
- 颜色、间距、排版标准
- 按钮、卡片、列表样式预设
- Flexbox布局辅助类

## 快速开始

### 1. 导入通用组件
```json
// pages/yourpage/yourpage.json
{
  "usingComponents": {
    "loading": "/components/common/loading",
    "modal": "/components/common/modal"
  }
}
```

### 2. 使用服务层
```javascript
// pages/yourpage/yourpage.js
const puzzleService = require('../../services/puzzle.js');
const pointsService = require('../../services/points.js');

async function submitAnswer(puzzleId, optionId) {
  const result = await puzzleService.submitAnswer(puzzleId, optionId);
  if (result.success) {
    console.log(`答对了！获得 ${result.pointsGained} 积分`);
  }
}
```

### 3. 使用工具函数
```javascript
const auth = require('../../utils/auth.js');
const storage = require('../../utils/storage.js');
const format = require('../../utils/format.js');
const validate = require('../../utils/validate.js');

// 检查登录
if (!auth.isLoggedIn()) {
  await auth.wxLogin();
}

// 保存数据
storage.set('key', value, 3600);  // 1小时过期

// 格式化时间
const time = format.formatDate(new Date(), 'YYYY-MM-DD HH:mm');

// 验证数据
const { valid, errors } = validate.validateObject(data, rules);
```

### 4. 调用云函数
```javascript
const request = require('../../utils/request.js');
const CONFIG = require('../../config/index.js');

// 直接调用
const result = await request.callFunction(
  CONFIG.api.puzzle.getTodayPuzzle,
  { timestamp: Date.now() }
);

// 支持自定义超时和重试
const result = await request.callFunction(
  'ranking_getFullRanking',
  { page: 1, pageSize: 10 },
  { timeout: 3000, retries: 2 }
);
```

## 性能优化

### 1. 缓存策略
- 排行榜缓存：60秒
- 用户信息缓存：30分钟
- 推荐内容缓存：1小时

### 2. 并发处理
- 最多允许10个并发请求
- 关键业务（库存扣减、积分转移）需使用事务

### 3. 请求优化
- 云函数调用支持自动重试
- 指数退避策略（1s、2s、4s）
- 统一超时控制

## 安全措施

### 1. 身份认证
- 基于微信OpenID认证
- Token管理和自动刷新
- 权限白名单校验

### 2. 输入验证
- 前端数据验证（长度、类型、格式）
- 后端必须二次验证
- XSS防护

### 3. 数据保护
- OpenID不暴露在前端
- 敏感数据（积分流水、借阅历史）权限控制
- 匿名反馈保护隐私

## 待完成任务

1. ⏳ 完成各页面实现（puzzle、ranking、borrow等）
2. ⏳ 编写云函数实现
3. ⏳ 添加更多业务服务（exchange、commission、dud等）
4. ⏳ 编写单元测试
5. ⏳ 性能监控和错误上报
6. ⏳ 离线缓存和同步机制

## 开发规范

### 命名约定
- 页面目录和文件：小写 (pages/index/)
- 组件目录和文件：小写 (components/common/)
- 函数和变量：驼峰式 (getUserInfo)
- 常量：大写带下划线 (MAX_RETRY_COUNT)

### 注释规范
- 使用JSDoc格式注释函数
- 复杂逻辑需要行注释
- 更新说明请标注时间和修改者

### 错误处理
- 所有异步操作必须有try-catch
- 返回统一的响应格式：{ success, data, error }
- 使用CONFIG中定义的错误代码

## 相关文档
- 需求文档：./docs/lab2_1_.pdf
- API规范：待编写
- 数据库设计：待编写
- 云函数清单：待编写
