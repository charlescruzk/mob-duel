// PauseMenu — lives inside the click-to-play overlay (which is what appears whenever
// the pointer lock drops), so "pause" and "resume" are the overlay itself. Buttons
// stop propagation so they never count as the click that resumes play.
import { ensureHudStyles } from './hudStyles.js';

export class PauseMenu {
  constructor(overlay, audio, touch) {
    this.overlay = overlay;
    this.audio = audio;
    this.touch = touch;
    this.room = '';
    if (!overlay) return;
    ensureHudStyles();
    const row = document.createElement('div');
    row.className = 'pm-row';
    const stop = (e) => e.stopPropagation();
    const lowfx = new URLSearchParams(location.search).has('lowfx');
    this.quality = this._button(row, lowfx ? 'QUALITY: LOW' : 'QUALITY: HIGH', () => {
      const q = new URLSearchParams(location.search);
      if (lowfx) { q.delete('lowfx'); q.set('hifx', '1'); } else { q.delete('hifx'); q.set('lowfx', '1'); }
      location.search = q.toString();
    });
    this.mute = this._button(row, audio && audio.muted ? 'SOUND: OFF' : 'SOUND: ON', () => {
      if (!this.audio) return;
      this.audio.setMuted(!this.audio.muted);
      this.mute.textContent = this.audio.muted ? 'SOUND: OFF' : 'SOUND: ON';
    });
    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.value = String(Math.round(((audio && audio.volume) || 0.8) * 100));
    vol.addEventListener('click', stop);
    vol.addEventListener('input', (e) => { stop(e); if (this.audio) this.audio.setVolume(Number(vol.value) / 100); });
    row.appendChild(vol);
    // Every big mobile MOBA exposes this: holding attack walks you into range.
    this.pursue = this._button(row, (touch && touch.pursuit === false) ? 'PURSUIT: OFF' : 'PURSUIT: ON', () => {
      if (!this.touch) return;
      this.touch.setPursuit(!this.touch.pursuit);
      this.pursue.textContent = this.touch.pursuit ? 'PURSUIT: ON' : 'PURSUIT: OFF';
    });
    this.pursue.className = 'pm-touch';
    this.change = this._button(row, 'CHANGE HERO', () => {
      const q = new URLSearchParams(location.search);
      q.delete('hero'); q.delete('enemy'); q.delete('room'); q.delete('solo');
      location.search = q.toString();
    });
    this.roomEl = document.createElement('span');
    row.appendChild(this.roomEl);
    overlay.appendChild(row);
    this.row = row;
  }

  _button(parent, text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    parent.appendChild(b);
    return b;
  }

  setRoom(code, seat) {
    this.room = code;
    if (this.roomEl) this.roomEl.textContent = code ? 'ROOM ' + code + ' · SEAT ' + (seat + 1) : '';
  }
}
