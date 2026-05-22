/**
 * 数据格式化工具模块
 */
class Format {
  formatDate(date, pattern = 'YYYY-MM-DD HH:mm:ss') {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) {
      return '';
    }

    const values = {
      YYYY: d.getFullYear(),
      MM: String(d.getMonth() + 1).padStart(2, '0'),
      DD: String(d.getDate()).padStart(2, '0'),
      HH: String(d.getHours()).padStart(2, '0'),
      mm: String(d.getMinutes()).padStart(2, '0'),
      ss: String(d.getSeconds()).padStart(2, '0')
    };

    return Object.keys(values).reduce((result, key) => (
      result.replace(key, values[key])
    ), pattern);
  }

  formatRelativeTime(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';

    const diff = Date.now() - d.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days === 1) return `昨天 ${this.formatDate(d, 'HH:mm')}`;
    if (days < 7) return `${days}天前`;
    return this.formatDate(d, 'YYYY-MM-DD');
  }

  formatNumber(num) {
    if (typeof num !== 'number' || Number.isNaN(num)) {
      return '0';
    }
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes) || 0;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  truncateText(text, length, suffix = '...') {
    if (!text || text.length <= length) {
      return text || '';
    }
    return text.substring(0, length) + suffix;
  }

  highlightKeywords(text, keywords) {
    if (!text) return text;

    const keywordArray = Array.isArray(keywords) ? keywords : [keywords];
    let result = text;

    keywordArray.forEach(keyword => {
      if (keyword) {
        const regex = new RegExp(keyword, 'gi');
        result = result.replace(regex, `<span class="highlight">${keyword}</span>`);
      }
    });

    return result;
  }

  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, char => map[char]);
  }

  formatPoints(points) {
    return `${this.formatNumber(Number(points) || 0)} pts`;
  }

  formatRank(rank) {
    if (!rank) {
      return '未入榜';
    }
    return `第${rank}名`;
  }

  formatPercentage(num, total, decimals = 2) {
    const denominator = Number(total) || 0;
    if (denominator === 0) return '0%';
    return `${((Number(num) || 0) / denominator * 100).toFixed(decimals)}%`;
  }

  formatStatus(statusCode) {
    const statusMap = {
      in_transit: '传递中',
      borrowed: '已借出',
      returned: '已归还',
      cancelled: '已取消',
      pending: '待处理',
      completed: '已完成',
      registered: '已报名',
      confirmed: '已确认',
      registering: '报名中',
      full: '已满',
      ended: '已结束',
      recruiting: '招募中',
      in_progress: '进行中',
      resolved: '已解决',
      closed: '已关闭',
      available: '在库',
      out_of_stock: '缺货',
      discontinued: '下架'
    };

    return statusMap[statusCode] || statusCode || '';
  }

  formatDifficulty(difficulty) {
    const difficultyMap = {
      easy: '简单',
      medium: '中等',
      hard: '困难',
      extreme: '极难'
    };
    return difficultyMap[difficulty] || difficulty || '';
  }

  formatCurrency(amount, currency = '¥') {
    return `${currency}${(Number(amount) || 0).toFixed(2)}`;
  }

  formatList(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return '';
    }
    return items.join('、');
  }

  getInitials(text, count = 1) {
    if (!text) return '';
    return text.split('').slice(0, count).join('').toUpperCase();
  }
}

module.exports = new Format();
