// Wire protocol shared by server/ and src/view/net/ (docs/PHASE4.md). JSON messages.
// Client → server: join, intent. Server → client: joined, start, snap, over, error.
// Everything the server accepts is validated here: intents are the ONLY player input.
export const TICK_MS = 50;
export const TICK_DT = 0.05;
export const PROTOCOL_VERSION = 1;
export const MAX_AIM = 200;              // metres; anything beyond is a forged intent

const INTENT_BOOLS = ['attack', 'q', 'w', 'e', 'r', 'recall'];

// Returns a sanitised intent (into `out`, allocation-free) or null when malformed.
export function sanitizeIntent(raw, out) {
  if (!raw || typeof raw !== 'object') return null;
  const mx = clamp(num(raw.moveX), -1, 1), mz = clamp(num(raw.moveZ), -1, 1);
  const len = Math.hypot(mx, mz);
  out.moveX = len > 1 ? mx / len : mx;
  out.moveZ = len > 1 ? mz / len : mz;
  out.aimX = clamp(num(raw.aimX), -MAX_AIM, MAX_AIM);
  out.aimZ = clamp(num(raw.aimZ), -MAX_AIM, MAX_AIM);
  for (let i = 0; i < INTENT_BOOLS.length; i++) out[INTENT_BOOLS[i]] = raw[INTENT_BOOLS[i]] === true;
  out.buy = intIn(raw.buy, -1, 63);
  out.useItem = intIn(raw.useItem, -1, 5);
  out.sell = intIn(raw.sell, -1, 5);
  return out;
}

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function intIn(v, lo, hi) { v = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : -1; return v < lo || v > hi ? -1 : v; }

export function isRoomCode(s) { return typeof s === 'string' && /^[A-Z]{4}$/.test(s); }

// Snapshot of one unit. Heroes carry everything the HUD, animator and ability bar read.
export function encodeUnit(u) {
  // Zero-valued optional fields are omitted; the mirror treats absence as zero.
  const o = { id: u.id, k: u.kind, tm: u.team, x: r2(u.pos.x), z: r2(u.pos.z), f: r2(u.facing), hp: r1(u.hp), mhp: r1(u.maxHp) };
  if (u.shield > 0) o.sh = r1(u.shield);
  if (!u.alive) o.d = 1;
  if (u.invulnerable) o.inv = 1;
  if (u.kind === 'minion') {
    o.rg = u.ranged ? 1 : 0; o.wv = u.wave;
    if (u.stunTimer > 0 || u.slowTimer > 0 || u.rootTimer > 0) o.st = [r2(u.stunTimer), r2(u.slowTimer), r2(u.slowPct), r2(u.rootTimer)];
  } else if (u.kind === 'hero') {
    const ab = u.abilities, at = u.attack;
    o.hk = u.heroKey; o.lv = u.level; o.xp = r1(u.xp); o.mp = r1(u.mp); o.mmp = r1(u.maxMp); o.g = Math.round(u.gold);
    o.cd = [r2(u.cooldowns.q), r2(u.cooldowns.w), r2(u.cooldowns.e), r2(u.cooldowns.r)];
    if (ab.stunTimer > 0 || ab.slowTimer > 0 || ab.rootTimer > 0 || ab.stealthTimer > 0 || ab.hasteTimer > 0 || ab.shieldTimer > 0) {
      o.st = [r2(ab.stunTimer), r2(ab.slowTimer), r2(ab.slowPct), r2(ab.rootTimer), r2(ab.stealthTimer), r2(ab.hasteTimer), r2(ab.shieldTimer)];
    }
    if (at.timer > 0 || at.windup > 0 || at.target) o.atk = [r2(at.timer), r2(at.windup), at.target ? at.target.id : 0];
    if (ab.cast.def) o.cast = [ab.cast.slot, r2(ab.cast.timer)];
    if (ab.dash.active) o.dash = [1, r2(ab.dash.dx), r2(ab.dash.dz)];
    if (u.isRecalling) o.rc = [1, r2(u.recallTimer)];
    if (!u.alive) o.rs = r2(u.respawnTimer);
    o.it = u.items ? u.items.map((it) => it.index) : [];
    o.ic = u.items ? u.items.map((it) => it.count || 0) : [];
    o.ks = u.kills | 0; o.ds = u.deaths | 0;
  }
  return o;
}

export function encodeEffects(effects) {
  const p = [], rg = [], zn = [];
  for (let i = 0; i < effects.projectiles.length; i++) {
    const q = effects.projectiles[i];
    if (q.active) p.push([i, r2(q.pos.x), r2(q.pos.y), r2(q.pos.z), q.color, r2(q.radius), q.slot, q.team]);
  }
  for (let i = 0; i < effects.rings.length; i++) { const d = effects.rings[i]; if (d.active) rg.push([i, r2(d.x), r2(d.z), r2(d.radius), r2(d.life), r2(d.maxLife), d.color]); }
  for (let i = 0; i < effects.zones.length; i++) { const d = effects.zones[i]; if (d.active) zn.push([i, r2(d.x), r2(d.z), r2(d.radius), r2(d.life), r2(d.maxLife), d.color]); }
  return { p, rg, zn };
}

function r1(v) { return Math.round(v * 10) / 10; }
function r2(v) { return Math.round(v * 100) / 100; }
