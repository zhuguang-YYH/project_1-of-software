const CONFIG = require('../config/index.js');
const { callFunction } = require('../utils/request.js');

class FeedbackService {
  async submit(params = {}) {
    const { content, feedback_type, is_anonymous } = params;
    if (!content || content.trim().length < 5) return { success: false, error: '反馈内容至少5个字' };

    try {
      const result = await callFunction(CONFIG.api.feedback.submit, {
        content: content.trim(),
        feedback_type: feedback_type || 'general',
        is_anonymous: !!is_anonymous
      });
      if (!result.success) return { success: false, error: result.message || '提交失败' };
      return { success: true, feedback_id: result.data && result.data.feedback_id };
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      return { success: false, error: error.message || '提交失败' };
    }
  }

  async getMyFeedback(options = {}) {
    try {
      const result = await callFunction(CONFIG.api.feedback.getMyFeedback, {
        page: options.page || 1,
        page_size: options.page_size || 50
      });

      if (!result.success) return { success: false, data: [], error: result.message || '获取反馈列表失败' };
      return {
        success: true,
        data: (result.data && result.data.list) || [],
        total: (result.data && result.data.total) || 0,
        has_more: !!(result.data && result.data.has_more)
      };
    } catch (error) {
      console.error('Failed to get feedback list:', error);
      return { success: false, data: [], error: error.message || '获取反馈列表失败' };
    }
  }
}

module.exports = new FeedbackService();
