const { storage } = require('./storage.js');

function getTheme() {
  const settings = storage.getSync('user_settings') || {};
  return settings.theme === 'gold' ? 'gold' : 'blue';
}

function getThemeState() {
  const theme = getTheme();
  return {
    theme,
    rankingCardTheme: theme === 'gold' ? 'dark' : 'light'
  };
}

function applyNativeTheme(theme) {
  if (typeof wx === 'undefined') return;

  const isGold = theme === 'gold';
  try {
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: isGold ? '#151515' : '#5b6cff'
    });
  } catch (error) {
    console.warn('setNavigationBarColor failed:', error);
  }

  try {
    wx.setBackgroundColor({
      backgroundColor: isGold ? '#0a0a0a' : '#f4f6fb',
      backgroundColorTop: isGold ? '#0a0a0a' : '#f4f6fb',
      backgroundColorBottom: isGold ? '#0a0a0a' : '#f4f6fb'
    });
  } catch (error) {
    console.warn('setBackgroundColor failed:', error);
  }

  try {
    wx.setTabBarStyle({
      color: isGold ? '#8d8063' : '#9aa3b8',
      selectedColor: isGold ? '#d4af37' : '#5b6cff',
      backgroundColor: isGold ? '#151515' : '#ffffff',
      borderStyle: isGold ? 'black' : 'white'
    });
  } catch (error) {
    console.warn('setTabBarStyle failed:', error);
  }
}

function applyTheme(page) {
  const state = getThemeState();
  applyNativeTheme(state.theme);
  if (!page || typeof page.setData !== 'function') return state;
  page.setData(state);
  return state;
}

module.exports = {
  getTheme,
  getThemeState,
  applyTheme,
  applyNativeTheme
};
