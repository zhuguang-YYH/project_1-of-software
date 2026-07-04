// 统一图片选择与上传封装：选择 → 大小校验 → 上传云存储 → 返回 fileID。
// 所有方法均返回 { success, ..., error } 结构，调用方按需处理，内部不向外抛异常
// （chooseImage 用户取消也视为 success:false，而非 reject）。

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 单张图片最大 5MB
const IMAGE_EXT_WHITELIST = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

// 判断是否为需要上传的本地临时路径（排除云存储、网络地址、本地静态资源、空值）
function isLocalTempPath(path) {
  if (!path || typeof path !== 'string') return false;
  // 云存储 fileID
  if (path.startsWith('cloud://')) return false;
  // 本地静态资源
  if (path.startsWith('/images/')) return false;
  // 微信开发者工具代理的临时文件（http://127.0.0.1:PORT/__tmp__/...）
  if (path.includes('/__tmp__/')) return true;
  // 真机上的临时路径（http://tmp/...、wxfile://... 等）
  if (path.startsWith('http://tmp/') || path.startsWith('wxfile://')) return true;
  // 其余 http/https 地址视为远程网络地址
  if (path.startsWith('http://') || path.startsWith('https://')) return false;
  // 其它本地路径（如真机上不带协议的临时路径）
  return true;
}

function extOf(path, fallback = 'jpg') {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(String(path || ''));
  const ext = match ? match[1].toLowerCase() : '';
  return IMAGE_EXT_WHITELIST.includes(ext) ? ext : fallback;
}

function safeSegment(value, fallback) {
  const segment = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return segment || fallback;
}

// 生成稳定且不易碰撞的云存储路径：{dir}/{owner}_{时间戳}_{随机}.{ext}
function buildCloudPath(dir, owner, path) {
  const safeDir = safeSegment(dir, 'uploads');
  const safeOwner = safeSegment(owner, 'anon');
  const rand = Math.floor(Math.random() * 1e6);
  return `${safeDir}/${safeOwner}_${Date.now()}_${rand}.${extOf(path)}`;
}

// 选择图片：优先 wx.chooseMedia，回退 wx.chooseImage。返回 { success, files:[{path,size}], error }
function chooseImage(options = {}) {
  const count = options.count || 1;
  const sizeType = options.sizeType || ['compressed'];
  const sourceType = options.sourceType || ['album', 'camera'];

  return new Promise((resolve) => {
    if (typeof wx !== 'undefined' && wx.chooseMedia) {
      wx.chooseMedia({
        count,
        mediaType: ['image'],
        sizeType,
        sourceType,
        success: (res) => {
          const files = (res.tempFiles || []).map(item => ({ path: item.tempFilePath, size: item.size || 0 }));
          resolve({ success: true, files });
        },
        fail: (err) => resolve({ success: false, files: [], error: (err && err.errMsg) || '已取消选择' })
      });
    } else {
      wx.chooseImage({
        count,
        sizeType,
        sourceType,
        success: (res) => {
          const paths = res.tempFilePaths || [];
          const sizes = (res.tempFiles || []).map(item => item.size || 0);
          const files = paths.map((path, index) => ({ path, size: sizes[index] || 0 }));
          resolve({ success: true, files });
        },
        fail: (err) => resolve({ success: false, files: [], error: (err && err.errMsg) || '已取消选择' })
      });
    }
  });
}

// 上传单个本地文件到云存储，返回 { success, fileID, cloudPath, error }
async function uploadToCloud(filePath, options = {}) {
  if (!filePath) return { success: false, error: '文件路径为空' };

  const maxSize = options.maxSize || DEFAULT_MAX_SIZE;
  if (options.size && options.size > maxSize) {
    return { success: false, error: `图片不能超过 ${Math.floor(maxSize / 1024 / 1024)}MB` };
  }

  const cloudPath = options.cloudPath || buildCloudPath(options.dir, options.owner, filePath);
  try {
    const res = await wx.cloud.uploadFile({ cloudPath, filePath });
    if (!res || !res.fileID) return { success: false, error: '上传失败' };
    return { success: true, fileID: res.fileID, cloudPath };
  } catch (error) {
    console.error('uploadToCloud failed:', error);
    return { success: false, error: (error && error.errMsg) || '上传失败' };
  }
}

// 若为本地临时路径则上传并返回 fileID，否则原样返回（用于"可能已是远端地址"的场景）。
// 注意：上传失败返回 success:false，由调用方决定是否阻断流程（避免误存临时路径）。
async function uploadIfNeeded(path, options = {}) {
  if (!isLocalTempPath(path)) return { success: true, fileID: path, skipped: true };
  return uploadToCloud(path, options);
}

// 选择 + 上传一步到位（默认单张）
async function chooseAndUpload(options = {}) {
  const picked = await chooseImage(options);
  if (!picked.success || picked.files.length === 0) {
    return { success: false, error: picked.error || '未选择图片' };
  }
  const file = picked.files[0];
  return uploadToCloud(file.path, { ...options, size: file.size });
}

module.exports = {
  isLocalTempPath,
  buildCloudPath,
  chooseImage,
  uploadToCloud,
  uploadIfNeeded,
  chooseAndUpload
};
