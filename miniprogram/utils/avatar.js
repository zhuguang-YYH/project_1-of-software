const DEFAULT_AVATAR = '/images/icons/avatar.png';

function normalizeAvatarUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  const lower = value.toLowerCase();

  if (
    lower.startsWith('wxfile://') ||
    lower.startsWith('http://tmp/') ||
    lower.includes('/__tmp__/') ||
    lower.includes('127.0.0.1') ||
    lower.includes('localhost')
  ) {
    return '';
  }

  return value;
}

async function resolveCloudAvatarUrls(list = []) {
  const items = Array.isArray(list) ? list : [];
  const file_ids = Array.from(new Set(
    items
      .map(item => normalizeAvatarUrl(item && item.avatar_url))
      .filter(url => url.startsWith('cloud://'))
  ));

  if (!file_ids.length || typeof wx === 'undefined' || !wx.cloud || !wx.cloud.getTempFileURL) {
    return items.map(item => ({
      ...item,
      avatar_url: normalizeAvatarUrl(item && item.avatar_url)
    }));
  }

  try {
    const res = await wx.cloud.getTempFileURL({ fileList: file_ids });
    const url_map = {};
    (res.fileList || []).forEach(file => {
      if (file && file.fileID && file.tempFileURL) {
        url_map[file.fileID] = file.tempFileURL;
      }
    });

    return items.map(item => {
      const avatar_url = normalizeAvatarUrl(item && item.avatar_url);
      return {
        ...item,
        avatar_url: url_map[avatar_url] || avatar_url
      };
    });
  } catch (error) {
    console.error('resolveCloudAvatarUrls failed:', error);
    return items.map(item => ({
      ...item,
      avatar_url: normalizeAvatarUrl(item && item.avatar_url)
    }));
  }
}

module.exports = {
  DEFAULT_AVATAR,
  normalizeAvatarUrl,
  resolveCloudAvatarUrls
};
