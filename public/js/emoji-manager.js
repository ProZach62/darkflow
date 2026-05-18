export const EMOJI_ALIASES = {
  '+1': '👍',
  '-1': '👎',
  '100': '💯',
  angry: '😠',
  astonished: '😲',
  beer: '🍺',
  beers: '🍻',
  blush: '😊',
  boom: '💥',
  bow: '🙇',
  broken_heart: '💔',
  bug: '🐛',
  clap: '👏',
  cold_face: '🥶',
  confused: '😕',
  cool: '😎',
  cry: '😢',
  dagger: '🗡️',
  dizzy: '💫',
  dragon: '🐉',
  eyes: '👀',
  facepalm: '🤦',
  fire: '🔥',
  ghost: '👻',
  gift: '🎁',
  grin: '😁',
  grinning: '😀',
  heart: '❤️',
  heart_eyes: '😍',
  hourglass: '⌛',
  innocent: '😇',
  joy: '😂',
  kiss: '😘',
  laughing: '😆',
  mage: '🧙',
  medal: '🏅',
  moneybag: '💰',
  musical_note: '🎵',
  ok_hand: '👌',
  party: '🥳',
  pleading: '🥺',
  pray: '🙏',
  rage: '😡',
  raised_hands: '🙌',
  rofl: '🤣',
  rolling_eyes: '🙄',
  sad: '🙁',
  scream: '😱',
  shield: '🛡️',
  skull: '💀',
  skull_crossbones: '☠️',
  sleeping: '😴',
  slight_smile: '🙂',
  smile: '😄',
  smiley: '😃',
  smirk: '😏',
  sob: '😭',
  sparkles: '✨',
  star: '⭐',
  sunglasses: '😎',
  sword: '⚔️',
  thinking: '🤔',
  thumbsdown: '👎',
  thumbsup: '👍',
  tada: '🎉',
  trophy: '🏆',
  unamused: '😒',
  wave: '👋',
  wink: '😉',
  wizard: '🧙',
  worried: '😟',
  zap: '⚡',
};

const EMOJI_ALIAS_PATTERN = /:([a-z0-9_+-]+):/gi;
const TOKEN_PATTERN = /:([a-z0-9_+-]*)$/i;

const EMOJI_ENTRIES = Object.entries(EMOJI_ALIASES)
  .map(([alias, emoji]) => ({ alias, emoji, label: ':' + alias + ':' }))
  .sort((left, right) => left.alias.localeCompare(right.alias));

export function replaceEmojiAliases(text) {
  return String(text || '').replace(EMOJI_ALIAS_PATTERN, (match, alias) => {
    const emoji = EMOJI_ALIASES[String(alias).toLowerCase()];
    return emoji || match;
  });
}

export function findEmojiToken(value, cursor) {
  const text = String(value || '');
  const position = Number.isInteger(cursor) ? cursor : text.length;
  const beforeCursor = text.slice(0, position);
  const match = beforeCursor.match(TOKEN_PATTERN);

  if (!match) return null;
  return {
    start: position - match[0].length,
    end: position,
    query: match[1].toLowerCase(),
  };
}

export function getEmojiSuggestions(query = '', limit = 8) {
  const needle = String(query || '').toLowerCase();
  const exact = [];
  const prefix = [];
  const contains = [];

  for (const entry of EMOJI_ENTRIES) {
    if (!needle || entry.alias === needle) {
      exact.push(entry);
    } else if (entry.alias.startsWith(needle)) {
      prefix.push(entry);
    } else if (entry.alias.includes(needle)) {
      contains.push(entry);
    }
  }

  return exact.concat(prefix, contains).slice(0, limit);
}

export function replaceEmojiToken(value, token, emoji, appendSpace = false) {
  const text = String(value || '');
  const suffix = appendSpace ? ' ' : '';
  return text.slice(0, token.start) + emoji + suffix + text.slice(token.end);
}
