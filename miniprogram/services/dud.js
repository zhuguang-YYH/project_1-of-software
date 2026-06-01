const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class DudService {
  async chat(message, session_id = '') {
    if (!message || !message.trim()) return { success: false, error: '消息不能为空' };

    try {
      const result = await callFunction(CONFIG.api.dud.chat, {
        message: message.trim(),
        session_id: session_id || ''
      });
      if (!result.success) return { success: false, code: result.code, error: result.message || '发送失败' };
      return {
        success: true,
        reply: (result.data && result.data.reply) || '',
        session_id: (result.data && result.data.session_id) || session_id,
        points_earned: (result.data && result.data.points_earned) || 0
      };
    } catch (error) {
      console.error('Failed to send chat message:', error);
      return { success: false, error: error.message || '发送失败' };
    }
  }

  async getChatHistory(session_id) {
    if (!session_id) return { success: false, data: [], error: '会话编号不能为空' };

    try {
      const result = await callFunction(CONFIG.api.dud.getChatHistory, { session_id });
      if (!result.success) return { success: false, data: [], error: result.message || '获取聊天记录失败' };
      return {
        success: true,
        data: (result.data && result.data.messages) || [],
        session_id
      };
    } catch (error) {
      console.error('Failed to get chat history:', error);
      return { success: false, data: [], error: error.message || '获取聊天记录失败' };
    }
  }
}

module.exports = new DudService();
