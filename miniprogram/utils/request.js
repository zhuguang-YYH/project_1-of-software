const CONFIG = require('../config/index.js');

const ROUTED_CLOUD_FUNCTIONS = [
  'user',
  'puzzle',
  'ranking',
  'borrow',
  'exchange',
  'activity',
  'commission',
  'dud',
  'profile',
  'feedback',
  'recommendation',
  'points',
  'admin'
];

// 飞行中请求去重窗口，防止用户双击按钮重复提交。
// key = functionName + JSON(data中指定的幂等字段)
const IN_FLIGHT_WINDOW_MS = 1500;
const inFlightRequests = new Map();

class Request {
  async callFunction(functionName, data = {}, options = {}) {
    const timeout = options.timeout || CONFIG.timeout.default;
    const retries = options.retries || 1;
    let lastError = null;

    // 幂等模式：自动注入 client_request_id（仅首次生成，重试复用同一个）
    const useIdempotent = options.idempotent === true;
    if (useIdempotent && !data.client_request_id) {
      data.client_request_id = this.generateRequestId();
    }

    // 飞行中去重：同一函数 + 同一幂等键 + 短时间窗口，复用上一次 promise
    const dedupKey = useIdempotent
      ? `${functionName}::${data.client_request_id}`
      : null;
    if (dedupKey && inFlightRequests.has(dedupKey)) {
      return inFlightRequests.get(dedupKey);
    }

    const runOnce = async () => {
      for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
          const response = await Promise.race([
            wx.cloud.callFunction({
              name: functionName,
              data: {
                ...data,
                _timestamp: Date.now(),
                _requestId: this.generateRequestId()
              },
              config: { timeout }
            }),
            this.createTimeout(timeout)
          ]);

          return this.normalizeCloudResponse(response);
        } catch (error) {
          lastError = error;
          if (attempt < retries - 1) {
            await this.sleep(Math.pow(2, attempt) * 1000);
          }
        }
      }
      throw this.handleError(lastError, functionName);
    };

    const promise = (async () => {
      const result = await runOnce();
      // 登录态失效：尝试静默重登一次后重试请求（user_login 自身除外，避免无限递归）
      if (
        result && result.success === false &&
        this.isAuthExpiredCode(result.code) &&
        functionName !== 'user' &&
        options._noAuthRetry !== true
      ) {
        const relogged = await this.tryRefreshLogin();
        if (relogged) {
          // 重新发起一次请求，复用相同 client_request_id（幂等模式下）保证后端去重
          return this.callFunction(functionName, data, { ...options, _noAuthRetry: true });
        }
        this.handleAuthExpired();
      }
      return result;
    })();

    if (dedupKey) {
      inFlightRequests.set(dedupKey, promise);
      // 请求结束后保留一个短窗口，期间重复调用仍命中同一 promise
      promise.finally(() => {
        setTimeout(() => inFlightRequests.delete(dedupKey), IN_FLIGHT_WINDOW_MS);
      });
    }

    return promise;
  }

  async callCloudFunction(functionName, data = {}, options = {}) {
    const parts = functionName.split('_');

    if (parts.length >= 2 && ROUTED_CLOUD_FUNCTIONS.includes(parts[0])) {
      const moduleName = parts[0];
      const action = parts.slice(1).join('_');
      // 若调用方未显式指定 timeout，自动应用模块专属超时或默认值
      const routedOptions = options.timeout ? options : {
        ...options,
        timeout: CONFIG.timeout[moduleName] || CONFIG.timeout.default
      };

      return this.callFunction(moduleName, {
        action,
        ...data
      }, routedOptions);
    }

    return this.callFunction(functionName, data, options);
  }

  async get(url, params = {}, options = {}) {
    return this.request(url, {
      method: 'GET',
      data: params,
      ...options
    });
  }

  async post(url, data = {}, options = {}) {
    return this.request(url, {
      method: 'POST',
      data,
      ...options
    });
  }

  async request(url, requestConfig) {
    const timeout = requestConfig.timeout || CONFIG.timeout.default;

    return Promise.race([
      new Promise((resolve, reject) => {
        wx.request({
          url,
          method: requestConfig.method || 'GET',
          data: requestConfig.data,
          header: {
            'Content-Type': 'application/json',
            'X-Request-ID': this.generateRequestId(),
            ...requestConfig.header
          },
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(res.data);
            } else {
              reject(this.createError('HTTP_ERROR', res.statusCode, res.data));
            }
          },
          fail: reject
        });
      }),
      this.createTimeout(timeout)
    ]);
  }

  generateRequestId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  // 判断后端返回的错误码是否属于"登录态失效"
  isAuthExpiredCode(code) {
    if (!code) return false;
    const c = String(code).toUpperCase();
    return c === 'USER_NOT_FOUND' || c === 'NOT_LOGGED_IN' || c === 'AUTH_EXPIRED' || c === 'UNAUTHORIZED';
  }

  // 静默重登：返回是否成功。运行时按需 require auth，避免循环依赖
  async tryRefreshLogin() {
    try {
      const { auth } = require('./auth.js');
      return await auth.refreshToken();
    } catch (e) {
      console.warn('[Request] silent re-login failed:', e);
      return false;
    }
  }

  // 重登仍失败：提示用户，清理登录状态
  handleAuthExpired() {
    try {
      const { storage } = require('./storage.js');
      storage.removeToken();
      storage.removeSync('user_info');
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app.globalData) {
        app.globalData.isLoggedIn = false;
        app.globalData.userInfo = null;
        app.globalData.userId = null;
      }
      wx.showToast({ title: '登录已失效，请重试', icon: 'none' });
    } catch (e) {
      // 兜底静默
    }
  }

  normalizeCloudResponse(response) {
    const result = response && Object.prototype.hasOwnProperty.call(response, 'result')
      ? response.result
      : response;

    if (!result || typeof result !== 'object') {
      return {
        success: false,
        code: CONFIG.errorCode.UNKNOWN_ERROR,
        data: null,
        message: '云函数返回格式异常'
      };
    }

    const success = result.success === true || result.code === 0;
    const data = result.data !== undefined ? result.data : null;

    return {
      ...((data && typeof data === 'object' && !Array.isArray(data)) ? data : {}),
      ...result,
      success,
      data,
      error: result.error || (success ? null : result.message)
    };
  }

  createTimeout(timeout) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(this.createError('TIMEOUT', CONFIG.errorCode.TIMEOUT));
      }, timeout);
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  createError(type, code, details = null) {
    const error = new Error(type);
    error.code = code;
    error.details = details;
    error.timestamp = Date.now();
    return error;
  }

  handleError(error = {}, context = '') {
    console.error(`[Request Error] ${context}:`, error);

    if (error.message === 'TIMEOUT') {
      return this.createError('TIMEOUT', CONFIG.errorCode.TIMEOUT, {
        message: '请求超时，请检查网络连接'
      });
    }

    if (error.code === 'PERMISSION_DENIED') {
      return this.createError('AUTH_ERROR', CONFIG.errorCode.PERMISSION_DENIED, {
        message: '权限不足，请重新登录'
      });
    }

    if (error.errCode === -1) {
      return this.createError('NETWORK_ERROR', CONFIG.errorCode.NETWORK_ERROR, {
        message: '网络连接失败'
      });
    }

    return this.createError('SERVER_ERROR', CONFIG.errorCode.SERVER_ERROR, {
      message: error.message || '服务器错误，请稍后重试',
      originalError: error
    });
  }
}

const request = new Request();

const callCloudFunction = (functionName, data = {}, options = {}) => (
  request.callCloudFunction(functionName, data, options)
);

const callFunction = (functionName, data = {}, options = {}) => (
  request.callCloudFunction(functionName, data, options)
);

module.exports = {
  request,
  callCloudFunction,
  callFunction
};
