function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMentionText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function messageMentionsPlayer(text, playerName) {
  const name = String(playerName || '').trim();
  if (!name) return false;
  const pattern = new RegExp('(^|[^\\w])@' + escapeRegExp(name) + '(?=$|[^\\w])', 'i');
  return pattern.test(String(text || ''));
}
