// HeroSelect: the pre-match overlay. Six cards built once from heroData — a canvas
// portrait (silhouette per kit, trim colour per hero), name, role badge, passive and
// the four abilities. Clicking a card picks the player hero; `?hero=` skips it.
// Elements are built once here and never rebuilt.
import { HEROES, HERO_KEYS } from '../../sim/hero/heroData.js';

// Same trim palette as heroMesh.js, as canvas-friendly hex strings.
const TRIM = {
  brakk: '#6b6b6b', ilyra: '#f2c84b', vaskra: '#9fd6ff',
  kesh: '#b06be0', halvard: '#8a9aa8', lumen: '#2fa8c8',
};
const ATTR_LABEL = { str: 'STR', agi: 'AGI', int: 'INT' };
const BODY = '#23282f';

// One silhouette per hero on a 96×96 canvas: the same visual hook as the in-match
// mesh (helm, hat, hood, bow, crest…) so the card reads as that hero.
const PORTRAITS = {
  brakk: (c, s) => {                 // blocky helm + wide shoulders
    c.fillRect(s * 0.30, s * 0.42, s * 0.40, s * 0.34);
    c.fillRect(s * 0.22, s * 0.50, s * 0.56, s * 0.10);
    c.fillRect(s * 0.34, s * 0.20, s * 0.32, s * 0.20);
  },
  halvard: (c, s) => {               // tower shield plate + crest
    c.fillRect(s * 0.52, s * 0.18, s * 0.16, s * 0.58);
    c.fillRect(s * 0.28, s * 0.42, s * 0.28, s * 0.34);
    c.fillRect(s * 0.40, s * 0.14, s * 0.20, s * 0.07);
  },
  vaskra: (c, s) => {                // brimmed cap + bow arc
    c.fillRect(s * 0.42, s * 0.44, s * 0.16, s * 0.32);
    c.fillRect(s * 0.34, s * 0.22, s * 0.32, s * 0.08);
    c.beginPath();
    c.arc(s * 0.70, s * 0.56, s * 0.16, Math.PI * 0.5, Math.PI * 1.5);
    c.stroke();
  },
  kesh: (c, s) => {                  // pointed hood + cowl
    c.beginPath();
    c.moveTo(s * 0.50, s * 0.14);
    c.lineTo(s * 0.68, s * 0.52);
    c.lineTo(s * 0.32, s * 0.52);
    c.closePath();
    c.fill();
    c.fillRect(s * 0.36, s * 0.52, s * 0.28, s * 0.24);
  },
  ilyra: (c, s) => {                 // tall cone hat + ember orb
    c.beginPath();
    c.moveTo(s * 0.50, s * 0.10);
    c.lineTo(s * 0.66, s * 0.46);
    c.lineTo(s * 0.34, s * 0.46);
    c.closePath();
    c.fill();
    c.fillRect(s * 0.38, s * 0.46, s * 0.24, s * 0.30);
    c.beginPath();
    c.arc(s * 0.76, s * 0.62, s * 0.06, 0, Math.PI * 2);
    c.fill();
  },
  lumen: (c, s) => {                 // tidal crest + floating orb
    c.beginPath();
    c.moveTo(s * 0.50, s * 0.18);
    c.lineTo(s * 0.64, s * 0.44);
    c.lineTo(s * 0.36, s * 0.44);
    c.closePath();
    c.fill();
    c.fillRect(s * 0.38, s * 0.44, s * 0.24, s * 0.32);
    c.beginPath();
    c.arc(s * 0.26, s * 0.60, s * 0.06, 0, Math.PI * 2);
    c.fill();
  },
};

function drawPortrait(canvas, key) {
  const s = canvas.width;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.clearRect(0, 0, s, s);
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fillRect(0, 0, s, s);
  c.strokeStyle = TRIM[key] || '#fff';
  c.lineWidth = 3;
  c.fillStyle = TRIM[key] || '#fff';
  (PORTRAITS[key] || PORTRAITS.brakk)(c, s);
}

export class HeroSelect {
  // root: the #hero-select overlay element; onPick(heroKey) fires once per click.
  constructor(root, onPick) {
    if (!root || typeof onPick !== 'function') return;
    this.root = root;
    this.cards = [];
    const grid = root.querySelector('.hs-grid') || root;
    for (let i = 0; i < HERO_KEYS.length; i++) {
      const key = HERO_KEYS[i];
      const d = HEROES[key];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hs-card';
      card.dataset.hero = key;

      const title = document.createElement('div');
      title.className = 'hs-name';
      title.textContent = d.name + ' — ' + d.title;

      const badge = document.createElement('div');
      badge.className = 'hs-badge';
      badge.textContent = d.primary.toUpperCase() + ' · ' + d.role;

      const portrait = document.createElement('canvas');
      portrait.className = 'hs-portrait';
      portrait.width = 96;
      portrait.height = 96;
      drawPortrait(portrait, key);

      const abil = document.createElement('div');
      abil.className = 'hs-abil';
      const slots = ['q', 'w', 'e', 'r'];
      for (let s = 0; s < slots.length; s++) {
        const row = document.createElement('div');
        row.className = 'hs-ab-row';
        const k = document.createElement('b');
        k.textContent = slots[s].toUpperCase();
        const n = document.createElement('span');
        n.textContent = d.abilities[slots[s]].name;
        row.appendChild(k);
        row.appendChild(n);
        abil.appendChild(row);
      }

      const pas = document.createElement('div');
      pas.className = 'hs-passive';
      pas.textContent = 'P ' + (d.passive && d.passive.name ? d.passive.name : '');

      card.appendChild(portrait);
      card.appendChild(title);
      card.appendChild(badge);
      card.appendChild(abil);
      card.appendChild(pas);
      card.addEventListener('click', () => onPick(key));
      grid.appendChild(card);
      this.cards.push(card);
    }
  }
}