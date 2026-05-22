#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
云函数重构脚本：将 exports.module_action 改为使用 main 入口 + action 路由
"""

import os
import re
import sys

# 需要处理的云函数
CLOUD_FUNCTIONS = {
    'activity': ['getActivities', 'getMyActivities', 'register', 'cancel', 'getActivityDetail'],
    'borrow': ['getItems', 'getItemDetail', 'applyBorrow', 'getBorrowHistory', 'cancelBorrow', 'getScripts'],
    'exchange': ['getGoods', 'getProductDetail', 'doExchange', 'getExchangeHistory'],
    'points': ['getUserPoints', 'addPoints', 'deductPoints'],
    'profile': ['getCard', 'updateCard', 'getMyPoints'],
    'commission': ['getCommissions', 'getCommissionDetail', 'publish', 'accept', 'complete', 'allocateRewards', 'getMyCommissions'],
    'dud': ['chat', 'getChatHistory'],
    'recommendation': ['getRecommendations'],
    'feedback': ['submit', 'getMyFeedback']
}

def refactor_cloud_function(module_name, actions):
    """重构单个云函数文件"""
    base_path = f'd:\\WeChatApp\\cloudfunctions\\{module_name}\\index.js'
    
    if not os.path.exists(base_path):
        print(f"⚠️  文件不存在: {base_path}")
        return False
    
    with open(base_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 检查是否已经改造过
    if 'exports.main = async' in content:
        print(f"✓ {module_name} 已改造过")
        return True
    
    # 步骤1: 将 exports.module_action 改为 const module_action
    # 模式: exports.module_action = async (event, context) =>
    pattern = r'exports\.' + f'({module_name}_\\w+)' + r'\s*=\s*async\s*\('
    content = re.sub(pattern, rf'const \1 = async (', content)
    
    # 步骤2: 在文件末尾添加 main 路由
    # 移除末尾可能的空行
    content = content.rstrip()
    
    # 生成 action 映射
    action_map = '\n    '.join([f"'{action}': {module_name}_{action}," for action in actions])
    
    # 生成 main 函数
    main_function = f"""

// 主入口：路由到具体的函数
exports.main = async (event, context) => {{
  const {{ action = '{actions[0] if actions else 'default'}', ...data }} = event;
  
  const actions = {{
    {action_map}
  }};
  
  const handler = actions[action];
  if (!handler) {{
    return {{
      code: -1,
      message: `未知的操作: ${{action}}`
    }};
  }}
  
  return await handler({{ ...data }}, context);
}};
"""
    
    # 添加 main 函数到文件末尾
    content += main_function
    
    # 写回文件
    with open(base_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"✓ {module_name} 改造完成")
    return True

def main():
    print("🔧 开始改造云函数...")
    print("=" * 50)
    
    for module, actions in CLOUD_FUNCTIONS.items():
        try:
            refactor_cloud_function(module, actions)
        except Exception as e:
            print(f"❌ {module} 改造失败: {e}")
    
    print("=" * 50)
    print("✅ 所有云函数改造完成!")
    print("💡 提示: 需要重新部署所有改造过的云函数")

if __name__ == '__main__':
    main()
