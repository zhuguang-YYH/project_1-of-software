const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class DudService {
  async chat(message) {
    const trimmed = String(message || '').trim();
    if (!trimmed) return { success: false, error: '消息不能为空' };

    try {
      const result = await callFunction(CONFIG.api.dud.chat, { message: trimmed });
      if (!result.success) return { success: false, code: result.code, error: result.message || '发送失败' };

      const data = result.data || {};
      const reply_content = data.reply_content
        || (data.dud_message && data.dud_message.message)
        || '';
      return {
        success: true,
        reply_content,
        matched_keyword: data.matched_keyword || '',
        match_type: data.match_type || '',
        rule_id: data.rule_id || ''
      };
    } catch (error) {
      console.error('Failed to send chat message:', error);
      return { success: false, error: error.message || '发送失败' };
    }
  }

  async getChatHistory(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.dud.getChatHistory, {
        page: options.page || 1,
        page_size: options.page_size || 50
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取聊天记录失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error('Failed to get chat history:', error);
      return { success: false, data: [], error: error.message || '获取聊天记录失败' };
    }
  }
}

module.exports = new DudService();
