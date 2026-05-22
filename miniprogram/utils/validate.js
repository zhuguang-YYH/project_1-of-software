/**
 * 数据验证模块
 * 处理各类输入数据的验证
 */

class Validate {
  /**
   * 验证是否为空
   * @param {any} value - 值
   * @returns {boolean}
   */
  isEmpty(value) {
    return value === null || value === undefined || value === '' || 
           (Array.isArray(value) && value.length === 0);
  }

  /**
   * 验证邮箱
   * @param {string} email - 邮箱地址
   * @returns {boolean}
   */
  isEmail(email) {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email);
  }

  /**
   * 验证电话号码
   * @param {string} phone - 电话号码
   * @returns {boolean}
   */
  isPhone(phone) {
    const pattern = /^1[3-9]\d{9}$/;
    return pattern.test(phone);
  }

  /**
   * 验证URL
   * @param {string} url - URL地址
   * @returns {boolean}
   */
  isUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 验证中文名字
   * @param {string} name - 名字
   * @returns {boolean}
   */
  isChineseName(name) {
    const pattern = /^[\u4e00-\u9fa5]+$/;
    return pattern.test(name);
  }

  /**
   * 验证身份证号
   * @param {string} idCard - 身份证号
   * @returns {boolean}
   */
  isIdCard(idCard) {
    const pattern = /^(1[1-5]|2[1-3]|3[1-7]|4[1-6]|5[0-4]|6[1-5]|7[1-5]|8[1-2]|91)\d{4}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/;
    return pattern.test(idCard);
  }

  /**
   * 验证字符串长度
   * @param {string} str - 字符串
   * @param {number} minLength - 最小长度
   * @param {number} maxLength - 最大长度
   * @returns {boolean}
   */
  isLengthBetween(str, minLength, maxLength) {
    if (!str) return minLength === 0;
    return str.length >= minLength && str.length <= maxLength;
  }

  /**
   * 验证是否为正整数
   * @param {any} value - 值
   * @returns {boolean}
   */
  isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  /**
   * 验证是否为非负整数
   * @param {any} value - 值
   * @returns {boolean}
   */
  isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  /**
   * 验证是否为数字
   * @param {any} value - 值
   * @returns {boolean}
   */
  isNumber(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
  }

  /**
   * 验证是否为布尔值
   * @param {any} value - 值
   * @returns {boolean}
   */
  isBoolean(value) {
    return typeof value === 'boolean';
  }

  /**
   * 验证是否为日期
   * @param {any} value - 值
   * @returns {boolean}
   */
  isDate(value) {
    return value instanceof Date && !isNaN(value.getTime());
  }

  /**
   * 验证是否为有效的日期字符串
   * @param {string} dateStr - 日期字符串
   * @returns {boolean}
   */
  isValidDateString(dateStr) {
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }

  /**
   * 验证数组中是否全为指定类型
   * @param {array} arr - 数组
   * @param {string} type - 类型名称
   * @returns {boolean}
   */
  isArrayOfType(arr, type) {
    if (!Array.isArray(arr)) return false;
    return arr.every(item => typeof item === type);
  }

  /**
   * 验证对象是否包含特定键
   * @param {object} obj - 对象
   * @param {array} keys - 键数组
   * @returns {boolean}
   */
  hasKeys(obj, keys) {
    if (typeof obj !== 'object' || obj === null) return false;
    return keys.every(key => key in obj);
  }

  /**
   * 验证文本内容（防止XSS）
   * @param {string} text - 文本
   * @returns {boolean}
   */
  isSafeText(text) {
    if (!text) return true;
    // 检查危险的HTML标签和脚本
    const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+=/i, /<iframe/i];
    return !dangerousPatterns.some(pattern => pattern.test(text));
  }

  /**
   * 验证积分值
   * @param {any} points - 积分值
   * @returns {boolean}
   */
  isValidPoints(points) {
    return this.isNonNegativeInteger(points);
  }

  /**
   * 验证排名
   * @param {any} rank - 排名
   * @returns {boolean}
   */
  isValidRank(rank) {
    return this.isPositiveInteger(rank);
  }

  /**
   * 验证活动人数上限
   * @param {any} capacity - 上限
   * @returns {boolean}
   */
  isValidCapacity(capacity) {
    return this.isPositiveInteger(capacity) && capacity <= 10000;
  }

  /**
   * 验证库存数量
   * @param {any} quantity - 数量
   * @returns {boolean}
   */
  isValidQuantity(quantity) {
    return this.isNonNegativeInteger(quantity);
  }

  /**
   * 验证是否为未来时间
   * @param {Date|string|number} date - 日期
   * @returns {boolean}
   */
  isFutureDate(date) {
    const d = new Date(date);
    return d > new Date();
  }

  /**
   * 验证是否为过去时间
   * @param {Date|string|number} date - 日期
   * @returns {boolean}
   */
  isPastDate(date) {
    const d = new Date(date);
    return d < new Date();
  }

  /**
   * 验证时间范围是否有效
   * @param {Date|string|number} startTime - 开始时间
   * @param {Date|string|number} endTime - 结束时间
   * @returns {boolean}
   */
  isValidTimeRange(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return start < end;
  }

  /**
   * 验证对象是否为空
   * @param {object} obj - 对象
   * @returns {boolean}
   */
  isEmptyObject(obj) {
    return typeof obj === 'object' && obj !== null && Object.keys(obj).length === 0;
  }

  /**
   * 验证密码强度
   * @param {string} password - 密码
   * @returns {object} { strength: 'weak'|'medium'|'strong', score: 0-100 }
   */
  validatePasswordStrength(password) {
    let score = 0;

    if (password.length >= 8) score += 20;
    if (password.length >= 12) score += 20;

    if (/[a-z]/.test(password)) score += 15;
    if (/[A-Z]/.test(password)) score += 15;
    if (/[0-9]/.test(password)) score += 15;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 15;

    let strength = 'weak';
    if (score >= 70) strength = 'strong';
    else if (score >= 40) strength = 'medium';

    return {
      strength,
      score: Math.min(score, 100)
    };
  }

  /**
   * 批量验证对象字段
   * @param {object} data - 数据对象
   * @param {object} rules - 验证规则
   * @returns {object} { valid: boolean, errors: object }
   */
  validateObject(data, rules) {
    const errors = {};
    let valid = true;

    for (const field in rules) {
      const rule = rules[field];
      const value = data[field];

      // 必填验证
      if (rule.required && this.isEmpty(value)) {
        errors[field] = rule.message || `${field}不能为空`;
        valid = false;
      }

      // 类型验证
      if (rule.type && !this.isEmpty(value)) {
        if (typeof value !== rule.type) {
          errors[field] = `${field}类型不正确`;
          valid = false;
        }
      }

      // 长度验证
      if (rule.minLength && value && value.length < rule.minLength) {
        errors[field] = `${field}长度不能少于${rule.minLength}`;
        valid = false;
      }

      if (rule.maxLength && value && value.length > rule.maxLength) {
        errors[field] = `${field}长度不能超过${rule.maxLength}`;
        valid = false;
      }

      // 自定义验证函数
      if (rule.validate && typeof rule.validate === 'function') {
        if (!rule.validate(value)) {
          errors[field] = rule.message || `${field}验证失败`;
          valid = false;
        }
      }
    }

    return { valid, errors };
  }
}

module.exports = new Validate();
