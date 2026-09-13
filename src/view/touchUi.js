// Touch UI DOM: built once, updated in place. Layout keeps the middle of the screen
// clear: a floating joystick lives wherever the left thumb lands, the skill arc sits
// in the bottom-right corner, utilities in a short row above it, menu top-left.
const CSS =
  ':root{--tu:clamp(44px,9.5vmin,68px)}' +
  'body.touch #reticle,body.touch #ability-bar{display:none!important}' +
  'body.touch #status{left:calc(12px + env(safe-area-inset-left));bottom:auto;top:calc(10px + env(safe-area-inset-top));transform:scale(.85);transform-origin:left top}' +
  'body.touch #level-badge{left:calc(12px + env(safe-area-inset-left));bottom:auto;top:calc(72px + env(safe-area-inset-top))}' +
  'body.touch #gold{right:auto;left:calc(120px + env(safe-area-inset-left));bottom:auto;top:calc(72px + env(safe-area-inset-top));font-size:16px}' +
  'body.touch #minimap{width:200px;height:20px;right:calc(12px + env(safe-area-inset-right))}' +
  'body.touch #kill-feed{top:40px;right:calc(12px + env(safe-area-inset-right))}' +
  'body.touch #shop{top:56px;right:calc(12px + env(safe-area-inset-right));max-height:70vh;overflow:auto}' +
  '#touch-ui{position:fixed;inset:0;pointer-events:none;z-index:9;display:none;font-family:monospace}' +
  'body.touch #touch-ui{display:block}' +
  '#tj{position:absolute;width:calc(var(--tu)*2.4);height:calc(var(--tu)*2.4);margin:calc(var(--tu)*-1.2) 0 0 calc(var(--tu)*-1.2);border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.06);opacity:0;will-change:transform,opacity}' +
  '#tj i{position:absolute;left:50%;top:50%;width:calc(var(--tu)*.95);height:calc(var(--tu)*.95);margin:calc(var(--tu)*-.475) 0 0 calc(var(--tu)*-.475);border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 0 10px rgba(0,0,0,.5)}' +
  '#tj.on{opacity:1}' +
  '.tb{position:absolute;pointer-events:auto;border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(14,18,28,.72);color:#e8e6e0;display:flex;align-items:center;justify-content:center;flex-direction:column;font:700 12px/1 monospace;letter-spacing:.06em;text-shadow:0 0 3px #000;box-shadow:0 2px 10px rgba(0,0,0,.45);touch-action:none;-webkit-tap-highlight-color:transparent;overflow:hidden}' +
  '.tb b{font-size:15px}.tb small{font-size:9px;opacity:.75;margin-top:2px;max-width:90%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.tb .cd{position:absolute;inset:0;border-radius:50%;background:conic-gradient(rgba(0,0,0,.65) var(--p,0%),transparent 0);pointer-events:none}' +
  '.tb .n{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;color:#ffd36b;pointer-events:none;display:none}' +
  '.tb.cool .n{display:flex}.tb.cool b,.tb.cool small{opacity:.35}' +
  '.tb.dim{opacity:.4}.tb.press{border-color:#ffd36b;background:rgba(59,111,214,.55)}' +
  '.tb.aiming{border-color:#4fd8e0;background:rgba(79,216,224,.35)}' +
  '#tb-atk{width:calc(var(--tu)*1.55);height:calc(var(--tu)*1.55);right:calc(14px + env(safe-area-inset-right));bottom:calc(14px + env(safe-area-inset-bottom));border-color:rgba(255,120,120,.7)}' +
  '#tb-q,#tb-w,#tb-e,#tb-r{width:calc(var(--tu)*1.1);height:calc(var(--tu)*1.1)}' +
  '#tb-q{right:calc(var(--tu)*1.95 + 14px + env(safe-area-inset-right));bottom:calc(8px + env(safe-area-inset-bottom))}' +
  '#tb-w{right:calc(var(--tu)*1.85 + 14px + env(safe-area-inset-right));bottom:calc(var(--tu)*1.3 + 14px + env(safe-area-inset-bottom))}' +
  '#tb-e{right:calc(var(--tu)*.85 + 14px + env(safe-area-inset-right));bottom:calc(var(--tu)*2.05 + 14px + env(safe-area-inset-bottom))}' +
  '#tb-r{right:calc(14px + env(safe-area-inset-right));bottom:calc(var(--tu)*2.55 + 22px + env(safe-area-inset-bottom));width:calc(var(--tu)*1.2);height:calc(var(--tu)*1.2);border-color:rgba(242,200,75,.75)}' +
  '.tu{width:calc(var(--tu)*.72);height:calc(var(--tu)*.72);font-size:10px;border-radius:12px}' +
  '#tb-rec{right:calc(var(--tu)*3.3 + 14px + env(safe-area-inset-right));bottom:calc(var(--tu)*.05 + 14px + env(safe-area-inset-bottom))}' +
  '#tb-pot{right:calc(var(--tu)*3.3 + 14px + env(safe-area-inset-right));bottom:calc(var(--tu)*.95 + 14px + env(safe-area-inset-bottom))}' +
  '#tb-shop{right:calc(var(--tu)*3.3 + 14px + env(safe-area-inset-right));bottom:calc(var(--tu)*1.85 + 14px + env(safe-area-inset-bottom))}' +
  '#tb-menu{left:calc(12px + env(safe-area-inset-left));top:calc(118px + env(safe-area-inset-top));width:calc(var(--tu)*.7);height:calc(var(--tu)*.7);border-radius:10px;font-size:14px}' +
  '#tb-look{position:absolute;left:44%;top:0;right:0;bottom:0;pointer-events:auto;touch-action:none}' +
  '#tb-move{position:absolute;left:0;top:0;width:44%;bottom:0;pointer-events:auto;touch-action:none}' +
  '#rotate-prompt{position:fixed;inset:0;z-index:30;display:none;align-items:center;justify-content:center;background:#0b0e16;color:#e8e6e0;font:700 16px/1.6 monospace;letter-spacing:.08em;text-align:center}' +
  'body.touch.portrait #rotate-prompt{display:flex}';

const SKILLS = ['q', 'w', 'e', 'r'];

export function buildTouchUi() {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('touch-ui-style')) {
    const style = document.createElement('style');
    style.id = 'touch-ui-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.id = 'touch-ui';
  const move = document.createElement('div'); move.id = 'tb-move'; root.appendChild(move);
  const look = document.createElement('div'); look.id = 'tb-look'; root.appendChild(look);
  const joy = document.createElement('div'); joy.id = 'tj'; joy.appendChild(document.createElement('i')); root.appendChild(joy);
  const btn = (id, label, sub, cls) => {
    const el = document.createElement('div');
    el.id = id; el.className = 'tb' + (cls ? ' ' + cls : '');
    const b = document.createElement('b'); b.textContent = label; el.appendChild(b);
    const s = document.createElement('small'); s.textContent = sub || ''; el.appendChild(s);
    const cd = document.createElement('div'); cd.className = 'cd'; el.appendChild(cd);
    const n = document.createElement('div'); n.className = 'n'; el.appendChild(n);
    root.appendChild(el);
    return { el, label: b, sub: s, cd, num: n, _p: -1, _n: '', _cls: '' };
  };
  const ui = {
    root, move, look, joy, knob: joy.firstChild,
    atk: btn('tb-atk', 'ATK', ''),
    skills: {},
    rec: btn('tb-rec', 'B', 'recall', 'tu'),
    pot: btn('tb-pot', '1', 'potion', 'tu'),
    shop: btn('tb-shop', 'P', 'shop', 'tu'),
    menu: btn('tb-menu', '≡', '', ''),
  };
  for (let i = 0; i < SKILLS.length; i++) ui.skills[SKILLS[i]] = btn('tb-' + SKILLS[i], SKILLS[i].toUpperCase(), '');
  const rot = document.createElement('div');
  rot.id = 'rotate-prompt';
  rot.textContent = 'ROTATE YOUR PHONE\nlandscape only';
  rot.style.whiteSpace = 'pre';
  document.body.appendChild(rot);
  document.body.appendChild(root);
  return ui;
}

// Cooldown sweep + seconds + dim state, only touching the DOM when a value changes.
export function setButtonState(b, frac, seconds, dim, name) {
  const p = Math.round(frac * 100);
  if (p !== b._p) { b._p = p; b.cd.style.setProperty('--p', p + '%'); }
  const n = seconds > 0 ? String(Math.ceil(seconds)) : '';
  if (n !== b._n) { b._n = n; b.num.textContent = n; b.el.classList.toggle('cool', n !== ''); }
  const cls = dim ? 'dim' : '';
  if (cls !== b._cls) { b._cls = cls; b.el.classList.toggle('dim', dim); }
  if (name !== undefined && name !== b.sub.textContent) b.sub.textContent = name;
}
