/**
 * 应用全局配置文件
 * 集中管理API端点、云函数名称、常量配置等
 */

const CONFIG = {
  // 云开发环境ID
  cloudEnv: 'cloud1',
  cloudEnvId: 'cloud1-d6g9sz3rn0b612135',
  appId: 'wx907be1236a6e72bc',
  tencentCloudAccountId: '100049004918',

  // API 配置
  api: {
    // 用户相关
    user: {
      login: 'user_login',
      getUserInfo: 'user_getUserInfo',
      updateProfile: 'user_updateProfile',
      logout: 'user_logout'
    },

    // 每日谜题
    puzzle: {
      getTodayPuzzle: 'puzzle_getTodayPuzzle',
      getPuzzleHistory: 'puzzle_getPuzzleHistory',
      submitAnswer: 'puzzle_submitAnswer',
      getPuzzleDetail: 'puzzle_getPuzzleDetail',
      subscribeDailyReminder: 'puzzle_subscribeDailyReminder'
    },

    // 排行榜
    ranking: {
      getTopThree: 'ranking_getTopThree',
      getFullRanking: 'ranking_getFullRanking',
      getUserRanking: 'ranking_getUserRanking'
    },

    // 物资借阅
    borrow: {
      getItems: 'borrow_getItems',
      getItemDetail: 'borrow_getItemDetail',
      applyBorrow: 'borrow_applyBorrow',
      cancelBorrow: 'borrow_cancelBorrow',
      getBorrowHistory: 'borrow_getBorrowHistory',
      getScripts: 'borrow_getScripts'
    },

    // 积分兑换
    exchange: {
      getProducts: 'exchange_getProducts',
      getProductDetail: 'exchange_getProductDetail',
      exchange: 'exchange_exchange',
      getExchangeHistory: 'exchange_getExchangeHistory'
    },

    // 活动管理
    activity: {
      getActivities: 'activity_getActivities',
      getActivityDetail: 'activity_getActivityDetail',
      register: 'activity_register',
      cancelRegister: 'activity_cancelRegister',
      getMyActivities: 'activity_getMyActivities'
    },

    // 事件委托
    commission: {
      getCommissions: 'commission_getCommissions',
      getCommissionDetail: 'commission_getCommissionDetail',
      publishCommission: 'commission_publishCommission',
      acceptCommission: 'commission_acceptCommission',
      completeCommission: 'commission_completeCommission',
      allocateRewards: 'commission_allocateRewards',
      getMyCommissions: 'commission_getMyCommissions'
    },

    // Dud 关键词回复
    dud: {
      chat: 'dud_chat',
      getChatHistory: 'dud_getChatHistory'
    },

    // 个人名片
    profile: {
      getCard: 'profile_getCard',
      updateCard: 'profile_updateCard',
      getPublicCard: 'profile_getPublicCard',
      getMyPoints: 'profile_getMyPoints'
    },

    // 反馈系统
    feedback: {
      submit: 'feedback_submit',
      getMyFeedback: 'feedback_getMyFeedback'
    },

    // 推荐内容
    recommendation: {
      getRecommendations: 'recommendation_getRecommendations',
      getDetail: 'recommendation_getDetail'
    }
  },

  // 超时配置（毫秒）
  timeout: {
    default: 10000,
    login: 12000,
    upload: 30000,
    // 按模块配置，超出 default 的复杂查询场景
    ranking: 12000,
    recommendation: 12000,
    puzzle: 10000,
    dud: 15000
  },

  // 分页配置
  pagination: {
    pageSize: 10,
    maxPages: 100
  },

  // 积分配置
  points: {
    // 总累计积分用于排行榜
    totalPoints: 'total_points',
    // 可兑换积分用于商城和委托
    availablePoints: 'available_points',
    // 冻结积分用于委托报酬
    frozenPoints: 'frozen_points'
  },

  // 业务常量
  business: {
    // 每日谜题限制
    puzzlePerDay: 1,

    // 排行榜展示
    topThreeCount: 3,
    topHundredCount: 100,

    // 并发处理
    maxConcurrentRequests: 10,

    // 频率限制
    rateLimit: {
      // Dud 聊天：30秒内最多5条
      dudChat: { messages: 5, seconds: 30 },
      // 答题提交：防重复
      puzzleSubmit: { times: 1, timeWindow: 24 * 60 * 60 * 1000 }
    }
  },

  // 缓存配置
  cache: {
    // 排行榜缓存时间（秒）
    rankingExpiry: 60,
    // 推荐内容缓存时间（秒）
    recommendationExpiry: 3600,
    // 用户信息缓存时间（秒）
    userInfoExpiry: 1800
  },

  // 状态枚举
  status: {
    // 借阅状态
    borrow: {
      inTransit: 'in_transit',      // 传递中
      borrowed: 'borrowed',          // 已借出
      returned: 'returned',          // 已归还
      cancelled: 'cancelled'         // 已取消
    },

    // 兑换状态
    exchange: {
      pending: 'pending',            // 待领取
      completed: 'completed',        // 已完成
      cancelled: 'cancelled'         // 已取消
    },

    // 活动状态
    activity: {
      registering: 'registering',    // 报名中
      full: 'full',                  // 已满
      ended: 'ended',                // 已结束
      cancelled: 'cancelled'         // 已取消
    },

    // 委托状态
    commission: {
      recruiting: 'recruiting',      // 招募中
      inProgress: 'in_progress',     // 进行中
      resolved: 'resolved',          // 已解决
      closed: 'closed'               // 已关闭
    },

    // 库存物品状态
    item: {
      available: 'available',        // 在库
      inTransit: 'in_transit',       // 传递中
      borrowed: 'borrowed',          // 已借出
      outOfStock: 'out_of_stock',    // 缺货
      discontinued: 'discontinued'   // 下架
    }
  },

  // 错误代码
  errorCode: {
    // 认证错误
    AUTH_FAILED: 'AUTH_FAILED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    NOT_LOGGED_IN: 'NOT_LOGGED_IN',

    // 业务错误
    ALREADY_ANSWERED: 'ALREADY_ANSWERED',
    INVALID_ANSWER: 'INVALID_ANSWER',
    INSUFFICIENT_POINTS: 'INSUFFICIENT_POINTS',
    OUT_OF_STOCK: 'OUT_OF_STOCK',
    ACTIVITY_FULL: 'ACTIVITY_FULL',
    DUPLICATE_REGISTRATION: 'DUPLICATE_REGISTRATION',
    CANCEL_DEADLINE_PASSED: 'CANCEL_DEADLINE_PASSED',

    // 系统错误
    NETWORK_ERROR: 'NETWORK_ERROR',
    SERVER_ERROR: 'SERVER_ERROR',
    TIMEOUT: 'TIMEOUT',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
  }
};

module.exports = CONFIG;
