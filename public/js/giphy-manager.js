import { gmcp } from './gmcp.js';

const PKG_SHOW = 'Darkwind.Giphy.Show';
const DEFAULT_DURATION_MS = 10000;

export const giphyManager = {
  els: {
    overlay: null,
    channel: null,
    talker: null,
    phrase: null,
    image: null,
  },

  hideTimer: null,
  renderToken: 0,

  init() {
    this.mount();
    gmcp.on(PKG_SHOW, (data) => this.show(data));
  },

  mount() {
    if (this.els.overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'giphy-overlay';

    const card = document.createElement('div');
    card.className = 'giphy-card';

    const meta = document.createElement('div');
    meta.className = 'giphy-meta';

    const channel = document.createElement('div');
    channel.className = 'giphy-channel';

    const talker = document.createElement('div');
    talker.className = 'giphy-talker';

    const phrase = document.createElement('div');
    phrase.className = 'giphy-phrase';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'giphy-image-wrap';

    const image = document.createElement('img');
    image.className = 'giphy-image';
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';

    imageWrap.appendChild(image);
    meta.appendChild(channel);
    meta.appendChild(talker);
    meta.appendChild(phrase);
    card.appendChild(meta);
    card.appendChild(imageWrap);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    this.els = {
      overlay,
      channel,
      talker,
      phrase,
      image,
    };
  },

  clearHideTimer() {
    if (!this.hideTimer) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  },

  hide() {
    this.clearHideTimer();
    this.renderToken += 1;

    if (!this.els.overlay) return;

    this.els.overlay.classList.remove('open');
    this.els.image.removeAttribute('src');
    this.els.image.alt = '';
  },

  show(data) {
    const gifUrl = data && typeof data.gifUrl === 'string' ? data.gifUrl.trim() : '';
    if (!gifUrl) {
      this.hide();
      return;
    }

    const durationMs = Math.max(
      1000,
      Number(data && data.durationMs) || DEFAULT_DURATION_MS
    );
    const token = ++this.renderToken;

    this.clearHideTimer();

    this.els.channel.textContent = data && data.channel ? data.channel : 'GIF';
    this.els.talker.textContent = data && data.talker ? data.talker : 'Someone';
    this.els.phrase.textContent = data && data.phrase
      ? '"' + data.phrase + '"'
      : '';

    this.els.image.alt = (this.els.talker.textContent || 'Someone')
      + ' shared a GIF'
      + (data && data.phrase ? ' for "' + data.phrase + '"' : '');

    this.els.image.onerror = () => {
      if (token !== this.renderToken) return;
      this.hide();
    };

    this.els.image.src = gifUrl;
    this.els.overlay.classList.add('open');

    this.hideTimer = setTimeout(() => {
      if (token !== this.renderToken) return;
      this.hide();
    }, durationMs);
  },
};
