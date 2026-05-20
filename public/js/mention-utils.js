const EXCLUDED_MENTION_CHANNELS = new Set([
  'attack-me',
  'attack-opp',
  'attack-obs',
  'events',
  'notify',
  'remote',
  'say',
  'system',
  'tell',
]);

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function isMentionChannel(value) {
  const channel = normalizeName(value);
  return channel && !EXCLUDED_MENTION_CHANNELS.has(channel);
}

export function normalizeChannels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeName).filter(Boolean))].sort();
}

export function normalizeChannelList(data) {
  const names = [];

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (typeof entry === 'string') {
        names.push(entry);
      } else if (entry && typeof entry === 'object') {
        names.push(entry.name || entry.channel || '');
      }
    }
  } else if (data && typeof data === 'object') {
    names.push(...Object.keys(data));
  }

  return names.map(normalizeName).filter(isMentionChannel);
}

export function normalizeRoster(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => {
      const name = normalizeName(entry.name);
      return {
        name,
        displayName: String(entry.displayName || entry.caption || entry.name || '').trim() || name,
        channels: normalizeChannels(entry.channels).filter(isMentionChannel),
      };
    })
    .filter(entry => entry.name && entry.channels.length);
}

export function findMentionToken(value, cursor) {
  const text = String(value || '');
  const end = cursor == null ? text.length : cursor;
  const before = text.slice(0, end);
  const match = /(^|\s)@([A-Za-z][A-Za-z0-9_-]*|)$/.exec(before);

  if (!match) return null;
  return {
    start: end - match[0].length + match[1].length,
    end,
    query: match[2] || '',
  };
}

export function detectChannelCommand(value, tokenStart, knownChannels) {
  const beforeToken = String(value || '').slice(0, tokenStart);
  const match = /^\s*(\S+)/.exec(beforeToken);
  let command;

  if (!match) return '';
  command = normalizeName(match[1]);
  if (!command || match.index + match[0].length > tokenStart) return '';
  if (!isMentionChannel(command)) return '';

  if (knownChannels.has(command)) return command;
  if (command.length > 1 && command[0] === 'e' && isMentionChannel(command.slice(1)) &&
      knownChannels.has(command.slice(1))) {
    return command.slice(1);
  }

  return '';
}

export function getMentionContext(value, cursor, knownChannels) {
  const token = findMentionToken(value, cursor);
  const channel = token ? detectChannelCommand(value, token.start, knownChannels) : '';

  if (!token || !channel) return null;
  return { token, channel };
}

export function getMentionSuggestions(players, channel, query, limit = 8) {
  const normalizedChannel = normalizeName(channel);
  const normalizedQuery = normalizeName(query);

  return normalizeRoster(players)
    .filter(entry => entry.channels.includes(normalizedChannel))
    .filter(entry =>
      !normalizedQuery ||
      entry.name.startsWith(normalizedQuery) ||
      normalizeName(entry.displayName).startsWith(normalizedQuery)
    )
    .sort((a, b) => normalizeName(a.displayName).localeCompare(normalizeName(b.displayName)))
    .slice(0, limit)
    .map(entry => ({ ...entry, channel: normalizedChannel }));
}
