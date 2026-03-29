export const MAX_LINES = 5000;
export const PRUNE_BATCH = 500;
export const MAX_HISTORY = 200;
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30000;
export const SESSION_KEY = 'darkwind-cmd-history';

export const FG_NAMES = ['black','red','green','yellow','blue','magenta','cyan','white'];
export const BRIGHT_FG_NAMES = ['bright-black','bright-red','bright-green','bright-yellow',
                         'bright-blue','bright-magenta','bright-cyan','bright-white'];

export const DEFAULT_FG = '#c9d1d9';
export const DEFAULT_BG = '#0d1117';

// 256-color lookup table
export const COLOR_256 = (() => {
  const table = [];
  const std = ['#0d1117','#ff7b72','#3fb950','#d29922','#58a6ff','#bc8cff','#39d2e0','#c9d1d9'];
  const bright = ['#6e7681','#ffa198','#56d364','#e3b341','#79c0ff','#d2a8ff','#56d4dd','#f0f6fc'];
  for (let i = 0; i < 8; i++) table.push(std[i]);
  for (let i = 0; i < 8; i++) table.push(bright[i]);
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++)
        table.push('#' + [levels[r], levels[g], levels[b]].map(v => v.toString(16).padStart(2,'0')).join(''));
  for (let i = 0; i < 24; i++) {
    const v = (8 + i * 10).toString(16).padStart(2, '0');
    table.push('#' + v + v + v);
  }
  return table;
})();
