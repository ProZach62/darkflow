export const PLAYER_FALLBACK_IMAGE = '/assets/avatar-ghost.svg';
export const NPC_FALLBACK_IMAGE = '/assets/generic-monster.png';

export function npcImageSource(source) {
  return typeof source === 'string' && source.trim()
    ? source
    : NPC_FALLBACK_IMAGE;
}

export function isNpcEnemy(enemy) {
  if (!enemy || typeof enemy !== 'object') return false;

  if (Object.prototype.hasOwnProperty.call(enemy, 'enemy_is_npc')) {
    const explicit = String(enemy.enemy_is_npc).trim().toLowerCase();
    return explicit === '1' || explicit === 'true' || explicit === 'on';
  }

  const condition = String(enemy.enemy_hp_string || '').trim().toLowerCase();
  return condition !== '' && condition !== 'none';
}

export function applyNpcImageFallback(img) {
  if (!img) return false;
  const current = typeof img.getAttribute === 'function'
    ? img.getAttribute('src')
    : img.src;
  if (current === NPC_FALLBACK_IMAGE ||
      String(img.src || '').endsWith(NPC_FALLBACK_IMAGE)) {
    return false;
  }
  img.src = NPC_FALLBACK_IMAGE;
  return true;
}
