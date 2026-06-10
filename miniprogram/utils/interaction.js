const REFRESH_INTERVAL = 1200;
const NO_MORE_TEXT = '没有更多了';

function canRefresh(page) {
  const now = Date.now();
  if (page.__refreshing || (page.__lastRefreshAt && now - page.__lastRefreshAt < REFRESH_INTERVAL)) {
    if (typeof wx !== 'undefined' && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    return false;
  }
  page.__refreshing = true;
  page.__lastRefreshAt = now;
  return true;
}

function finishRefresh(page) {
  page.__refreshing = false;
  if (typeof wx !== 'undefined' && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
  if (page.setData) page.setData({ refreshing: false });
}

module.exports = {
  NO_MORE_TEXT,
  canRefresh,
  finishRefresh
};
