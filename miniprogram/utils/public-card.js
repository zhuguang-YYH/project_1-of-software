function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePublicCard(data = {}, fallback = {}) {
  const interests = Array.isArray(data.interests)
    ? data.interests.join(', ')
    : String(data.interests || '');

  return {
    user_id: data.user_id || fallback.user_id || '',
    display_name: data.display_name || data.nickname || fallback.nickname || 'Detective',
    avatar_url: data.avatar_url || fallback.avatar_url || '',
    self_intro: data.self_intro || data.signature || 'No introduction yet.',
    interests,
    total_points: Number(data.total_points || fallback.total_points || 0),
    available_points: Number(data.available_points || 0),
    rank_no: Number(data.rank_no || fallback.rank_no || 0),
    created_text: formatDate(data.created_at || data.create_time),
    is_self: !!data.is_self,
    is_friend: !!data.is_friend,
    request_pending: !!data.request_pending
  };
}

module.exports = {
  normalizePublicCard
};
