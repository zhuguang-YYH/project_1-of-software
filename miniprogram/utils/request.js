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

class Request {
  async callFunction(functionName, data = {}, options = {}) {
    const timeout = options.timeout || CONFIG.timeout.default;
    const retries = options.retries || 1;
    let lastError = null;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const response = await Promise.race([
          wx.cloud.callFunction({
            name: functionName,
            data: {
              ...data,
              _timestamp: Date.now(),
              _requestId: this.generateRequestId()
            }
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
  }

  async callCloudFunction(functionName, data = {}, options = {}) {
    const parts = functionName.split('_');

    if (parts.length >= 2 && ROUTED_CLOUD_FUNCTIONS.includes(parts[0])) {
      const moduleName = parts[0];
      const action = parts.slice(1).join('_');
      const routedOptions = moduleName === 'user' && !options.timeout
        ? { ...options, timeout: CONFIG.timeout.login || 12000 }
        : options;

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
