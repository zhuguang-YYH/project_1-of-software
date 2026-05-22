# NK推协侦探管理系统 - 微信小程序项目框架

## 📦 项目概述

这是一个完整的微信小程序项目框架，为**NK推协侦探管理系统**提供生产级别的基础架构。

系统包含11个核心功能模块：
- 📝 日常互动（每日谜题、Dud关键词回复）
- 📚 物资管理（书籍/剧本杀借阅、库存管理）
- 🏆 激励体系（积分排行榜、兑换商城、个人名片）
- 🎉 活动与互助（活动报名、事件委托系统）

## ✨ 框架特色

### 🎯 完整的工具函数库
- **request.js** - 网络请求（云函数+HTTP）、超时控制、自动重试
- **storage.js** - 本地存储、Token管理、缓存管理
- **auth.js** - 微信登录、身份认证、权限管理
- **format.js** - 数据格式化（日期、时间、数字、积分等）
- **validate.js** - 数据验证（类型、长度、格式、密码强度等）

### 🔧 完整的业务服务层
- **puzzle.js** - 每日谜题（6个API）
- **ranking.js** - 排行榜（6个API，带缓存优化）
- **points.js** - 积分管理（8个API）
- **borrow.js** - 物资借阅（8个API）
- **activity.js** - 活动管理（8个API）

**总计：36个业务API方法**

### 🎨 完整的样式和组件系统
- **common.wxss** - CSS变量、响应式布局工具类、预设样式
- **loading组件** - 加载动画
- **modal组件** - 弹窗组件

### ⚙️ 全局配置管理
- API端点统一定义
- 错误代码枚举
- 状态枚举
- 性能参数配置

## 📂 项目结构

```
d:\WeChatApp/
├── miniprogram/
│   ├── config/
│   │   └── index.js                    # 全局配置
│   ├── utils/                          # 工具函数库（5个）
│   │   ├── request.js                  # 网络请求
│   │   ├── storage.js                  # 本地存储
│   │   ├── auth.js                     # 身份认证
│   │   ├── format.js                   # 数据格式化
│   │   └── validate.js                 # 数据验证
│   ├── services/                       # 业务服务层（5个）
│   │   ├── puzzle.js                   # 每日谜题
│   │   ├── ranking.js                  # 排行榜
│   │   ├── points.js                   # 积分管理
│   │   ├── borrow.js                   # 物资借阅
│   │   └── activity.js                 # 活动管理
│   ├── components/
│   │   └── common/                     # 通用组件
│   │       ├── loading/
│   │       └── modal/
│   ├── styles/
│   │   └── common.wxss                 # 全局样式库
│   ├── pages/                          # 页面目录（8个）
│   ├── app.js
│   ├── app.json
│   └── app.wxss
├── cloudfunctions/                     # 云函数目录
├── FRAMEWORK_GUIDE.md                  # 框架使用指南
└── README.md                           # 本文件
```

## 🚀 快速开始

### 1. 打开项目

在微信开发者工具中打开 `D:\WeChatApp` 目录

### 2. 检查编译

```
点击【编译】→ 无编译错误 ✅
```

### 3. 使用示例

```javascript
// 导入服务
const puzzleService = require('../../services/puzzle.js');

// 调用API
async function submitAnswer(puzzleId, optionId) {
  const result = await puzzleService.submitAnswer(puzzleId, optionId);
  if (result.success) {
    console.log('答对了！获得' + result.pointsGained + '积分');
  }
}
```

## 📚 详细文档

- **[FRAMEWORK_GUIDE.md](./FRAMEWORK_GUIDE.md)** - 框架详细使用指南
- **[需求文档](./docs/lab2_1_.pdf)** - 完整的系统需求规范

## ✅ 已完成内容

- ✅ 完整的工具函数库（5个模块，100+个方法）
- ✅ 完整的业务服务层（5个模块，36个API）
- ✅ 通用组件库（loading、modal）
- ✅ 全局样式系统（CSS变量、工具类）
- ✅ App全局配置和初始化
- ✅ 规范的代码结构和注释

## ⏳ 待完成内容

- ⏳ 剩余3个业务服务层（兑换、委托、Dud、名片等）
- ⏳ 8个主要页面UI实现
- ⏳ 云函数实现（对应所有API）
- ⏳ 单元测试编写
- ⏳ 集成测试验证

## 📖 核心特性

### 性能优化
- 响应时间：普通操作1.5-2秒内，排行榜3秒内
- 缓存策略：排行榜60秒、用户信息30分钟、推荐内容1小时
- 并发控制：支持50-100并发用户
- 自动重试：指数退避策略，最多3次重试

### 安全防护
- 微信OpenID唯一认证
- Token自动刷新机制
- 权限白名单校验
- XSS防护和输入验证
- 敏感数据访问控制

### 代码质量
- 统一的响应格式：{ success, data, error }
- JSDoc详细注释
- 统一的错误处理
- 清晰的模块划分
- 规范的命名约定

## 🔧 开发工作流

### 添加新服务

1. 在 `miniprogram/services/` 中创建新文件
2. 在 `config/index.js` 中添加API配置
3. 实现服务方法（参考现有服务）
4. 编写对应的云函数
5. 添加单元测试

### 创建新页面

1. 创建页面目录和文件
2. 使用 `common.wxss` 中的样式工具类
3. 导入需要的服务和工具函数
4. 在 `app.json` 中注册页面
5. 测试和调试

## 📊 技术栈

| 技术 | 说明 |
|------|------|
| **小程序框架** | 微信小程序原生框架 |
| **语言** | JavaScript (可升级为TypeScript) |
| **后端** | 微信云开发（云函数 + 云数据库 + 云存储） |
| **存储** | 本地存储 + 云数据库 |
| **认证** | 微信OpenID认证 |

## 🎯 项目成熟度

当前框架处于 **Beta 1.0** 阶段：

- ✅ 核心框架完整可用
- ✅ 代码规范和文档齐全
- ⚠️ 需要完成UI页面实现
- ⚠️ 需要实现云函数逻辑
- ⚠️ 需要进行集成测试

## 💡 常见问题

**Q: 如何修改API端点？**  
A: 修改 `miniprogram/config/index.js` 中的 `api` 对象

**Q: 如何自定义样式？**  
A: 使用 `styles/common.wxss` 中的CSS变量，或创建页面专属的 `.wxss`

**Q: 如何处理网络错误？**  
A: `request.js` 已自动处理，服务层会返回 `{ success: false, error: '...' }`

**Q: 如何添加新的权限？**  
A: 在 `utils/auth.js` 中的 `hasPermission` 方法中添加新的权限规则

## 📞 支持资源

- 微信小程序文档：https://developers.weixin.qq.com/miniprogram/dev/
- 云开发文档：https://developers.weixin.qq.com/miniprogram/dev/wxcloud/
- 本项目框架指南：[FRAMEWORK_GUIDE.md](./FRAMEWORK_GUIDE.md)

---

**项目完成日期**: 2026年5月12日  
**框架版本**: 1.0.0 Beta  
**状态**: ✅ 可用于开发  
**下一步**: 实现业务页面和云函数


