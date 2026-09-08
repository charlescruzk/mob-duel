// Status application and clearing for AbilitySystem — extracted from abilities.js to
// keep it under ~300 lines. applyStatus is the single entry every status kind goes
// through (minion CC timers and hero status timers share the same field names).
// Slows do not stack: strongest wins, an equal slow extends. Stun takes the longer
// remaining time. `sys` is the owning AbilitySystem, `sys.hero` the carrier.
import { endZone } from './abilityLibExt.js';

export function applyStatus(sys, kind, seconds, magnitude) {
  if (kind === 'stun') {
    if (seconds > sys.stunTimer) sys.stunTimer = seconds;
  } else if (kind === 'slow') {
    if (magnitude > sys.slowPct) { sys.slowPct = magnitude; sys.slowTimer = seconds; }
    else if (magnitude === sys.slowPct && seconds > sys.slowTimer) sys.slowTimer = seconds;
  } else if (kind === 'haste') {
    if (magnitude >= sys.hastePct) { sys.hastePct = magnitude; if (seconds > sys.hasteTimer) sys.hasteTimer = seconds; }
  } else if (kind === 'shield') {
    sys.hero.shield = magnitude;
    sys.shieldTimer = seconds;
  } else if (kind === 'root') {
    if (seconds > sys.rootTimer) sys.rootTimer = seconds;
  } else if (kind === 'stealth') {
    sys.stealthTimer = seconds;
  } else if (kind === 'attackSpeed') {
    if (magnitude >= sys.atkSpdPct) { sys.atkSpdPct = magnitude; sys.atkSpdTimer = seconds; }
  } else if (kind === 'armorBuff') {
    if (magnitude >= sys.armorBuffVal) { sys.armorBuffVal = magnitude; sys.armorBuffTimer = seconds; sys.hero.refreshArmor(); }
  } else if (kind === 'reflect') {
    sys.reflectVal = magnitude;
    sys.reflectTimer = seconds;
  } else if (kind === 'bonusNextAuto') {
    sys.bonusAutoDmg = magnitude;
    sys.bonusAutoTimer = seconds;
  }
}

// Death: statuses, shield, marks and any cast/dash/telegraph in progress go away.
// A live zone dies with its caster. Cooldowns are untouched — they keep ticking
// while dead (tickCooldowns).
export function clearStatus(sys) {
  sys.stunTimer = 0;
  sys.slowTimer = 0; sys.slowPct = 0;
  sys.hasteTimer = 0; sys.hastePct = 0;
  sys.shieldTimer = 0;
  sys.rootTimer = 0;
  sys.stealthTimer = 0;
  sys.stealthHaste = 0;
  sys.strikeUnit = null; sys.strikeUntil = 0;
  sys.atkSpdTimer = 0; sys.atkSpdPct = 0;
  sys.armorBuffTimer = 0; sys.armorBuffVal = 0;
  sys.reflectTimer = 0; sys.reflectVal = 0;
  sys.bonusAutoTimer = 0; sys.bonusAutoDmg = 0;
  sys.autoSlowTimer = 0; sys.autoSlowPct = 0; sys.autoSlowTime = 0;
  endZone(sys);                      // zone dies with its caster
  sys.hero.refreshArmor();
  sys.hero.shield = 0;
  sys.cast.def = null; sys.cast.timer = 0; sys.cast.slot = '';
  sys.dash.active = false;
  sys.field.active = false;
  for (let i = 0; i < sys.marks.length; i++) { sys.marks[i].unit = null; sys.marks[i].t = 0; }
}