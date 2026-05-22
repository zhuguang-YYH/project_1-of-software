# 云函数部署指南

## 当前状态
- ✅ 云函数代码已创建在 `cloudfunctions/` 文件夹
- ❌ 云函数还未部署到腾讯云环境
- ❌ 数据库集合还未创建

## 快速部署步骤

### 方案 A: 使用微信开发者工具部署（推荐）

#### 第1步: 部署云函数
1. 在微信开发者工具中打开项目
2. 找到 **云函数** 栏目（左侧导航）
3. 依次右键点击以下文件夹，选择 **上传并部署** → **云端安装依赖**

**部署顺序（从简到复杂）**:
```
1. user/            ← 必须首先部署（用户认证）
2. points/          ← 积分系统（被其他模块依赖）
3. puzzle/          ← 每日谜题
4. ranking/         ← 排行榜
5. activity/        ← 活动
6. borrow/          ← 借阅
7. exchange/        ← 兑换
8. profile/         ← 个人
9. commission/      ← 委托
10. dud/            ← 聊天
11. recommendation/ ← 推荐
12. feedback/       ← 反馈
```

#### 第2步: 验证部署
部署完成后，应该看到 **腾讯云开发平台** 中显示已部署的函数列表

### 方案 B: 腾讯云开发平台直接上传

1. 访问 https://console.cloudbase.tcb.com/
2. 切换到环境 `cloud1`
3. 进入 **云函数** → **新建云函数**
4. 逐个创建和上传上述文件夹中的代码

### 第3步: 创建数据库集合

在腾讯云开发平台 → **数据库** → **新建集合**，创建以下集合：

```json
// 用户相关
- users              // 用户信息
- points_log         // 积分变动日志

// 谜题系统
- puzzles            // 每日谜题
- puzzle_answers     // 答题记录

// 活动系统
- activities         // 活动列表
- activity_registrations  // 活动报名

// 借阅系统
- borrow_items       // 物资列表
- borrow_applications // 借阅申请
- borrow_scripts     // 借阅须知

// 兑换系统
- exchange_goods     // 兑换商品
- exchange_records   // 兑换记录

// 委托系统
- commissions        // 委托列表
- commission_acceptances // 委托接受

// DUD系统
- dud_keywords       // 关键词库
- dud_messages       // 聊天记录

// 反馈系统
- feedback           // 用户反馈
```

### 第4步: 添加初始数据（可选但推荐）

#### 示例数据 - puzzles 集合：
```javascript
{
  "date": "2024-05-19",
  "question": "2 + 2 = ?",
  "options": ["3", "4", "5", "6"],
  "correctAnswer": "4",
  "explanation": "二加二等于四",
  "difficulty": "easy"
}
```

#### 示例数据 - exchange_goods 集合：
```javascript
{
  "name": "小程序开发书",
  "description": "微信小程序开发完全指南",
  "cost": 100,
  "original_cost": 150,
  "stock": 50,
  "category": "book",
  "image": "",
  "exchangedCount": 0
}
```

## 常见问题排查

### 问题 1: "FunctionName parameter could not be found"
**原因**: 云函数未部署
**解决**: 按照上述步骤部署所有云函数

### 问题 2: "Collection not found"
**原因**: 数据库集合未创建
**解决**: 在腾讯云开发平台创建对应的集合

### 问题 3: 部署失败 "npm install error"
**原因**: package.json 中的依赖有问题
**解决**: 
- 检查网络连接
- 删除 node_modules（如果存在）
- 重新上传并部署

## 验证部署成功

部署完成后，打开小程序模拟器：
1. 如果页面能显示内容（即使是错误提示），说明云函数已连通
2. 查看控制台，不再出现 `FUNCTION_NOT_FOUND` 错误
3. 如果看到数据显示（排行榜、活动等），说明部署完全成功

## 下一步

- [ ] 部署所有云函数
- [ ] 创建所有数据库集合
- [ ] 添加初始测试数据
- [ ] 测试小程序功能
