import { FG_NAMES, BRIGHT_FG_NAMES, DEFAULT_FG, DEFAULT_BG, COLOR_256 } from './constants.js';

const ansi = {
  buffer: '',
  bold: false,
  underline: false,
  inverse: false,
  fg: null,
  bg: null,

  reset() {
    this.bold = false;
    this.underline = false;
    this.inverse = false;
    this.fg = null;
    this.bg = null;
  },

  snapshot() {
    return { bold: this.bold, underline: this.underline, inverse: this.inverse,
             fg: this.fg, bg: this.bg };
  }
};

export function parseAnsi(text) {
  text = ansi.buffer + text;
  ansi.buffer = '';

  const fragments = [];
  let plain = '';
  let i = 0;

  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      if (i + 1 >= text.length) {
        ansi.buffer = text.slice(i);
        break;
      }
      if (text[i + 1] === '[') {
        let j = i + 2;
        while (j < text.length && ((text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3f))) {
          j++;
        }
        if (j >= text.length) {
          ansi.buffer = text.slice(i);
          break;
        }
        const finalByte = text.charCodeAt(j);
        if (finalByte < 0x40 || finalByte > 0x7e) {
          i++;
          continue;
        }

        if (plain) {
          fragments.push({ text: plain, style: ansi.snapshot() });
          plain = '';
        }

        if (text[j] === 'm') {
          const paramStr = text.slice(i + 2, j);
          const params = paramStr === '' ? [0] : paramStr.split(';').map(Number);
          let p = 0;
          while (p < params.length) {
            const code = params[p];
            if (code === 0) { ansi.reset(); }
            else if (code === 1) { ansi.bold = true; }
            else if (code === 4) { ansi.underline = true; }
            else if (code === 7) { ansi.inverse = true; }
            else if (code === 22) { ansi.bold = false; }
            else if (code === 24) { ansi.underline = false; }
            else if (code === 27) { ansi.inverse = false; }
            else if (code >= 30 && code <= 37) { ansi.fg = { type: 'standard', index: code - 30 }; }
            else if (code === 38 && params[p+1] === 5 && p + 2 < params.length) {
              ansi.fg = { type: '256', index: params[p+2] };
              p += 2;
            }
            else if (code === 39) { ansi.fg = null; }
            else if (code >= 40 && code <= 47) { ansi.bg = { type: 'standard', index: code - 40 }; }
            else if (code === 48 && params[p+1] === 5 && p + 2 < params.length) {
              ansi.bg = { type: '256', index: params[p+2] };
              p += 2;
            }
            else if (code === 49) { ansi.bg = null; }
            else if (code >= 90 && code <= 97) { ansi.fg = { type: 'bright', index: code - 90 }; }
            else if (code >= 100 && code <= 107) { ansi.bg = { type: 'bright', index: code - 100 }; }
            p++;
          }
        }

        i = j + 1;
      } else {
        i += 2;
      }
    } else {
      plain += text[i];
      i++;
    }
  }

  if (plain) {
    fragments.push({ text: plain, style: ansi.snapshot() });
  }

  return fragments;
}

function resolveColor(color, isBackground) {
  if (!color) return isBackground ? DEFAULT_BG : DEFAULT_FG;
  if (color.type === '256') return COLOR_256[color.index] || (isBackground ? DEFAULT_BG : DEFAULT_FG);
  if (color.type === 'standard') return COLOR_256[color.index];
  if (color.type === 'bright') return COLOR_256[color.index + 8];
  return isBackground ? DEFAULT_BG : DEFAULT_FG;
}

export function styleToElement(text, style) {
  if (!text) return null;

  const needsStyling = style.bold || style.underline || style.inverse || style.fg || style.bg;
  if (!needsStyling) {
    return document.createTextNode(text);
  }

  const span = document.createElement('span');
  const classes = [];
  let inlineFg = null;
  let inlineBg = null;

  if (style.inverse) {
    inlineFg = resolveColor(style.bg, true);
    inlineBg = resolveColor(style.fg, false);
  } else {
    if (style.fg) {
      if (style.fg.type === '256') {
        inlineFg = COLOR_256[style.fg.index];
      } else if (style.fg.type === 'standard') {
        classes.push('ansi-fg-' + FG_NAMES[style.fg.index]);
      } else if (style.fg.type === 'bright') {
        classes.push('ansi-fg-' + BRIGHT_FG_NAMES[style.fg.index]);
      }
    }
    if (style.bg) {
      if (style.bg.type === '256') {
        inlineBg = COLOR_256[style.bg.index];
      } else if (style.bg.type === 'standard') {
        classes.push('ansi-bg-' + FG_NAMES[style.bg.index]);
      } else if (style.bg.type === 'bright') {
        classes.push('ansi-bg-' + BRIGHT_FG_NAMES[style.bg.index]);
      }
    }
  }

  if (style.bold) classes.push('ansi-bold');
  if (style.underline) classes.push('ansi-underline');

  if (classes.length) span.className = classes.join(' ');
  let inlineStyle = '';
  if (inlineFg) inlineStyle += 'color:' + inlineFg + ';';
  if (inlineBg) inlineStyle += 'background-color:' + inlineBg + ';';
  if (inlineStyle) span.setAttribute('style', inlineStyle);

  span.appendChild(document.createTextNode(text));
  return span;
}
