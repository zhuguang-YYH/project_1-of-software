const DEFAULT_AVATAR = '/images/icons/avatar.png';
let serverResolver = null;

function setAvatarUrlResolver(resolver) {
  serverResolver = typeof resolver === 'function' ? resolver : null;
}

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
      } else if (file && file.fileID) {
        console.warn('Avatar temp URL unavailable:', {
          fileID: file.fileID,
          status: file.status,
          errMsg: file.errMsg
        });
      }
    });

    const unresolved = file_ids.filter(fileID => !url_map[fileID]);
    if (unresolved.length && serverResolver) {
      try {
        const server_map = await serverResolver(unresolved);
        Object.assign(url_map, server_map || {});
      } catch (serverError) {
        console.error('server avatar resolver failed:', serverError);
      }
    }

    return applyResolvedAvatarUrls(items, url_map);
  } catch (error) {
    console.error('resolveCloudAvatarUrls failed:', error);
    if (serverResolver) {
      try {
        const url_map = await serverResolver(file_ids);
        return applyResolvedAvatarUrls(items, url_map || {});
      } catch (serverError) {
        console.error('server avatar resolver failed:', serverError);
      }
    }
    return applyResolvedAvatarUrls(items, {});
  }
}

function applyResolvedAvatarUrls(items, url_map = {}) {
  return items.map(item => {
    const avatar_url = normalizeAvatarUrl(item && item.avatar_url);
    const resolved_url = url_map[avatar_url] || avatar_url;
    return {
      ...item,
      avatar_url: resolved_url.startsWith('cloud://') ? DEFAULT_AVATAR : resolved_url
    };
  });
}

async function resolveCloudAvatarUrl(url) {
  const avatar_url = normalizeAvatarUrl(url);
  if (!avatar_url) return '';
  if (!avatar_url.startsWith('cloud://')) return avatar_url;

  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.getTempFileURL) {
    return DEFAULT_AVATAR;
  }

  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [avatar_url] });
    const file = res.fileList && res.fileList[0];
    if (file && file.tempFileURL) return file.tempFileURL;

    console.warn('Avatar temp URL unavailable:', {
      fileID: avatar_url,
      status: file && file.status,
      errMsg: file && file.errMsg
    });
    if (serverResolver) {
      try {
        const url_map = await serverResolver([avatar_url]);
        return (url_map && url_map[avatar_url]) || DEFAULT_AVATAR;
      } catch (serverError) {
        console.error('server avatar resolver failed:', serverError);
      }
    }
    return DEFAULT_AVATAR;
  } catch (error) {
    console.error('resolveCloudAvatarUrl failed:', error);
    if (serverResolver) {
      try {
        const url_map = await serverResolver([avatar_url]);
        return (url_map && url_map[avatar_url]) || DEFAULT_AVATAR;
      } catch (serverError) {
        console.error('server avatar resolver failed:', serverError);
      }
    }
    return DEFAULT_AVATAR;
  }
}

module.exports = {
  DEFAULT_AVATAR,
  normalizeAvatarUrl,
  resolveCloudAvatarUrl,
  resolveCloudAvatarUrls,
  setAvatarUrlResolver
};
