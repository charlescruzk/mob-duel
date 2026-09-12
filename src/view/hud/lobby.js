// Lobby — the mode bar under the hero cards: practice against the bot, or play
// online (server URL, create a room or join by code). The pick of a hero card then
// starts whichever mode is selected. The server URL is remembered in localStorage.
import { ensureHudStyles } from './hudStyles.js';

const KEY = 'mobaDuel.server';

export class Lobby {
  constructor(root) {
    this.mode = 'bot';
    this.server = '';
    this.room = 'new';
    this.solo = false;
    this.root = root;
    if (!root) return;
    ensureHudStyles();
    const q = new URLSearchParams(location.search);
    let saved = '';
    try { saved = localStorage.getItem(KEY) || ''; } catch { /* storage blocked */ }
    this.server = q.get('server') || saved || '';
    if (q.get('room')) { this.room = q.get('room'); }

    const bar = document.createElement('div');
    bar.className = 'lb-bar';
    this.bar = bar;
    this.btnBot = this._button(bar, 'PRACTICE VS BOT', () => this.setMode('bot'));
    this.btnOnline = this._button(bar, 'PLAY ONLINE', () => this.setMode('online'));
    const online = document.createElement('div');
    online.className = 'lb-online';
    this.serverInput = document.createElement('input');
    this.serverInput.placeholder = 'wss://your-server/ws';
    this.serverInput.value = this.server;
    this.serverInput.addEventListener('input', () => { this.server = this.serverInput.value.trim(); this._save(); });
    online.appendChild(this.serverInput);
    this.btnCreate = this._button(online, 'CREATE ROOM', () => { this.room = 'new'; this.solo = false; this._refresh(); });
    this.codeInput = document.createElement('input');
    this.codeInput.className = 'code';
    this.codeInput.placeholder = 'CODE';
    this.codeInput.maxLength = 4;
    this.codeInput.addEventListener('input', () => { this.room = this.codeInput.value.toUpperCase(); this._refresh(); });
    online.appendChild(this.codeInput);
    this.btnSolo = this._button(online, 'SOLO VS SERVER BOT', () => { this.room = 'new'; this.solo = true; this._refresh(); });
    bar.appendChild(online);
    this.hint = document.createElement('div');
    this.hint.className = 'lb-hint';
    bar.appendChild(this.hint);
    root.appendChild(bar);
    this.setMode(q.get('server') ? 'online' : 'bot');
  }

  _button(parent, text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    parent.appendChild(b);
    return b;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.bar) return;
    this.bar.classList.toggle('online', mode === 'online');
    this.btnBot.classList.toggle('on', mode === 'bot');
    this.btnOnline.classList.toggle('on', mode === 'online');
    this._refresh();
  }

  _refresh() {
    if (!this.hint) return;
    this.btnCreate.classList.toggle('on', this.room === 'new' && !this.solo);
    this.btnSolo.classList.toggle('on', this.solo);
    if (this.mode === 'bot') this.hint.textContent = 'pick a hero to duel the bot on this device';
    else if (!this.server) this.hint.textContent = 'enter the match server address, then pick a hero';
    else if (this.solo) this.hint.textContent = 'pick a hero: the server runs the match and its bot';
    else if (this.room === 'new') this.hint.textContent = 'pick a hero to create a room; share the 4-letter code shown at the top';
    else this.hint.textContent = 'pick a hero to join room ' + this.room;
  }

  _save() { try { localStorage.setItem(KEY, this.server); } catch { /* storage blocked */ } }

  // Parameters for online.js when the mode is online, else null.
  onlineParams(heroKey) {
    if (this.mode !== 'online' || !this.server) return null;
    return { server: this.server, room: this.room || 'new', hero: heroKey, solo: this.solo };
  }
}
