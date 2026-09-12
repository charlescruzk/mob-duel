// Shop panel: fills the reserved #shop root. Collapsed hint while the player stands in
// the fountain; P opens the full panel (pointer lock released so items are clickable),
// P / close / clicking back into the game re-locks. Four tabs (Consumables / Tier 1-3).
// Built once, updated in place, every DOM lookup guarded. Buying goes through Shop.buy.
import { ITEMS, INVENTORY_SLOTS, SELL_RATIO } from '../../sim/economy/items.js';

const REASON_TEXT = {
  ok: '', unknown: '', dead: 'Dead', fountain: 'Leave fountain to close',
  slots: 'Inventory full', unique: 'Already owned', gold: 'Not enough gold',
};

const TAB_LABELS = ['Consumables', 'Tier 1', 'Tier 2', 'Tier 3'];

const PASSIVE_TEXT = {
  burn: 'Burn: autos deal 15+2/lvl magic over 2 s',
  cleave: 'Cleave: autos also hit enemies near the target for 30%',
  rend: 'Rend: ability hits deal +4% target max HP magic',
  secondWind: 'Second Wind: below 30% HP, heal 15% max over 4 s (60 s CD)',
  tempo: 'Tempo: every 3rd auto deals +40 magic',
  spellShield: 'Spell Shield: blocks one enemy ability hit (40 s CD)',
  flow: 'Flow: each ability hit refunds 5 MP',
  execute: 'Execute: autos vs heroes below 40% HP deal +15%',
  undertow: 'Undertow: after a cast, your next auto slows 30% for 1 s',
};

const CSS =
  '#shop{width:300px;font:12px/1.4 monospace;color:#e8e6e0;background:rgba(10,12,18,.92);' +
  'border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:10px;box-shadow:0 0 12px #000}' +
  '#shop .sp-hint{font-weight:700;letter-spacing:.08em;color:#f2c84b}' +
  '#shop .sp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700}' +
  '#shop .sp-gold{color:#f2c84b}' +
  '#shop button{font:inherit;color:inherit;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);' +
  'border-radius:4px;cursor:pointer;text-align:left}' +
  '#shop button:hover{background:rgba(255,255,255,.14)}' +
  '#shop .sp-tabs{display:flex;gap:4px;margin-bottom:6px}' +
  '#shop .sp-tab{flex:1;padding:3px 4px;text-align:center;font-size:11px}' +
  '#shop .sp-tab.on{background:rgba(242,200,75,.22);border-color:rgba(242,200,75,.6)}' +
  '#shop .sp-item{display:block;width:100%;padding:6px 8px;margin-bottom:6px}' +
  '#shop .sp-item.off{opacity:.42;cursor:not-allowed}' +
  '#shop .sp-item b{display:inline-block;min-width:150px}#shop .sp-item i{color:#f2c84b;font-style:normal}' +
  '#shop .sp-item small{display:block;color:#a8a59c}' +
  '#shop .sp-inv{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px}' +
  '#shop .sp-slot{padding:4px 6px;min-height:28px;font-size:11px;color:#a8a59c;background:rgba(255,255,255,.04)}' +
  '#shop .sp-slot.full{color:#e8e6e0;cursor:pointer}#shop .sp-slot.full:hover{background:rgba(255,120,120,.18)}' +
  '#shop .sp-msg{margin-top:6px;min-height:16px;color:#ff9b6b}' +
  '#shop .sp-foot{margin-top:4px;color:#6c6a64;font-size:11px}';

export class ShopPanel {
  constructor(shop, input, hero) {
    this.shop = shop;
    this.input = input;
    this.hero = hero;
    this.open = false;
    this.root = document.getElementById('shop');
    this.hud = document.getElementById('hud');
    this._awaitUnlock = false;
    this._visible = false;
    this._gold = -1;
    this._reasons = new Array(ITEMS.length).fill('');
    this._slots = [null, null, null, null, null, null];
    this._slotCounts = [-1, -1, -1, -1, -1, -1];
    this._tab = -1;
    this._msg = '';
    this.itemEls = [];
    this.slotEls = [];
    if (!this.root) return;
    if (document.head) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this._build();
  }

  _build() {
    const root = this.root;
    this.hint = document.createElement('div');
    this.hint.className = 'sp-hint';
    this.hint.textContent = '[P] SHOP';
    root.appendChild(this.hint);

    this.body = document.createElement('div');
    this.body.hidden = true;
    const head = document.createElement('div');
    head.className = 'sp-head';
    const title = document.createElement('span');
    title.textContent = 'SHOP';
    this.goldEl = document.createElement('span');
    this.goldEl.className = 'sp-gold';
    const close = document.createElement('button');
    close.textContent = 'close [P]';
    close.addEventListener('click', () => this.close(true));
    head.appendChild(title); head.appendChild(this.goldEl); head.appendChild(close);
    this.body.appendChild(head);

    // Four tabs: Consumables (tier 'c') and Tiers 1-3. One container per tab, built
    // once; switching only toggles container visibility.
    const tabs = document.createElement('div');
    tabs.className = 'sp-tabs';
    this.tabEls = [];
    this.tabPanes = [];
    for (let t = 0; t < TAB_LABELS.length; t++) {
      const tb = document.createElement('button');
      tb.className = 'sp-tab';
      tb.textContent = TAB_LABELS[t];
      tb.addEventListener('click', () => this._setTab(t));
      tabs.appendChild(tb);
      this.tabEls.push(tb);
      const pane = document.createElement('div');
      pane.hidden = true;
      this.body.appendChild(pane);
      this.tabPanes.push(pane);
    }
    this.body.appendChild(tabs);

    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const b = document.createElement('button');
      b.className = 'sp-item';
      const name = document.createElement('b');
      name.textContent = it.name;
      const cost = document.createElement('i');
      cost.textContent = it.cost + ' g';
      const stats = document.createElement('small');
      const desc = it.stats + (it.unique ? ' (unique)' : '');
      const pv = PASSIVE_TEXT[it.passive];
      stats.textContent = pv ? desc + ' — ' + pv : desc;
      b.appendChild(name); b.appendChild(cost); b.appendChild(stats);
      b.addEventListener('click', () => this._onBuy(i));
      const tier = it.tier === 'c' ? 0 : it.tier;
      this.tabPanes[tier].appendChild(b);
      this.itemEls.push(b);
    }
    this._setTab(0);

    const inv = document.createElement('div');
    inv.className = 'sp-inv';
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const s = document.createElement('div');
      s.className = 'sp-slot';
      s.textContent = '—';
      s.addEventListener('click', () => this._onSell(i));
      inv.appendChild(s);
      this.slotEls.push(s);
    }
    this.body.appendChild(inv);
    this.msgEl = document.createElement('div');
    this.msgEl.className = 'sp-msg';
    this.body.appendChild(this.msgEl);
    const foot = document.createElement('div');
    foot.className = 'sp-foot';
    foot.textContent = 'click an owned slot to sell at ' + Math.round(SELL_RATIO * 100) + '%';
    this.body.appendChild(foot);
    root.appendChild(this.body);
  }

  _setTab(t) {
    if (t === this._tab || !this.tabEls) return;
    this._tab = t;
    for (let i = 0; i < this.tabEls.length; i++) {
      this.tabEls[i].classList.toggle('on', i === t);
      this.tabPanes[i].hidden = i !== t;
    }
  }

  _onBuy(i) {
    const r = this.shop.reason(this.hero, i);
    if (r === 'ok') { this.shop.buy(this.hero, i); this._setMsg(''); }
    else this._setMsg(REASON_TEXT[r] || r);
  }

  _onSell(i) {
    if (this.shop.sell(this.hero, i)) this._setMsg('');
  }

  _setMsg(text) {
    if (text === this._msg) return;
    this._msg = text;
    if (this.msgEl) this.msgEl.textContent = text;
  }

  openPanel() {
    if (this.open || !this.root) return;
    this.open = true;
    if (this.body) this.body.hidden = false;
    if (this.hint) this.hint.hidden = true;
    // #start-overlay sits at z-index 10 and reappears when the lock drops; lift the HUD
    // above it so the panel stays clickable. Restored on close.
    if (this.hud) { this._hudZ = this.hud.style.zIndex; this.hud.style.zIndex = '11'; }
    this._awaitUnlock = !!(this.input && this.input.locked);
    if (this.input && this.input.locked) this.input.exitPointerLock();
  }

  close(relock) {
    if (!this.open) return;
    this.open = false;
    if (this.body) this.body.hidden = true;
    if (this.hint) this.hint.hidden = false;
    if (this.hud) this.hud.style.zIndex = this._hudZ || '';
    this._setMsg('');
    if (relock && this.input && !this.input.locked) this.input.requestPointerLock();
  }

  update(dt) {
    if (!this.root) return;
    const hero = this.hero;
    const input = this.input;
    const inF = this.shop.inFountain(hero);
    if (input && input.justPressed('KeyP')) {
      if (this.open) this.close(true);
      else if (inF) this.openPanel();
    }
    if (this.open) {
      if (input && !input.locked) this._awaitUnlock = false;
      // Lock regained by clicking the game → the player left the shop.
      if (!inF || (input && input.locked && !this._awaitUnlock)) this.close(false);
    }
    const show = inF || this.open;
    if (show !== this._visible) {
      this._visible = show;
      this.root.style.display = show ? 'block' : 'none';
    }
    if (!this.open) return;

    const gold = Math.floor(hero.gold || 0);
    if (gold !== this._gold) {
      this._gold = gold;
      if (this.goldEl) this.goldEl.textContent = gold + ' g';
    }
    for (let i = 0; i < this.itemEls.length; i++) {
      const r = this.shop.reason(hero, i);
      if (r !== this._reasons[i]) {
        this._reasons[i] = r;
        this.itemEls[i].classList.toggle('off', r !== 'ok');
        this.itemEls[i].title = REASON_TEXT[r] || '';
      }
    }
    const inv = hero.items;
    for (let i = 0; i < this.slotEls.length; i++) {
      const it = inv && i < inv.length ? inv[i] : null;
      const n = it && it.consumable ? it.count : 1;
      if (it !== this._slots[i] || n !== this._slotCounts[i]) {
        this._slots[i] = it;
        this._slotCounts[i] = n;
        this.slotEls[i].textContent = it ? it.name + (n > 1 ? ' ×' + n : '') : '—';
        this.slotEls[i].classList.toggle('full', !!it);
      }
    }
  }
}
