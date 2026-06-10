const { storage } = require('./storage.js');

function cleanId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function rememberInviter(options = {}) {
  const inviterId = cleanId(options.inviter_id || options.inviterId || options.from_user_id);
  const current = storage.getUserInfo();
  if (inviterId && (!current || current.user_id !== inviterId)) {
    storage.setSync('pending_inviter_id', inviterId, 7 * 24 * 60 * 60);
  }
  return inviterId;
}

function getPendingInviterId() {
  return cleanId(storage.getSync('pending_inviter_id'));
}

function getShareInviterId() {
  const userInfo = storage.getUserInfo();
  return cleanId(userInfo && userInfo.user_id);
}

function appendShareParams(path, extra = {}) {
  const params = { ...extra };
  const inviterId = getShareInviterId();
  if (inviterId) params.inviter_id = inviterId;

  const query = Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

module.exports = {
  appendShareParams,
  getPendingInviterId,
  rememberInviter
};
