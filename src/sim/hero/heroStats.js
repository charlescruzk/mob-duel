// Stat resolution for Hero — extracted from hero.js to keep it under ~300 lines.
// recomputeStats folds heroData base + level + items into the derived stats;
// refreshArmor applies level + item armor + the strongest ability armor buff plus
// the Unyielding passive (Oroku: below threshold HP, +bonus armor, additive)
// and caps the total. Hero.update calls refreshArmor every frame so the passive
// tracks HP live without an armor setter fighting the Unit constructor.
import { atLevel, ATTR, ARMOR_CAP, ATTACK_SPEED_CAP, CDR_CAP } from './heroData.js';

export function recomputeStats(hero) {
  const d = hero.data, L = hero.level, s = hero.itemStats, A = ATTR;
  hero.maxHp = atLevel(d.hp, L) + s.maxHp + s.str * A.strMaxHp;
  hero.maxMp = atLevel(d.mp, L) + s.maxMp + s.int * A.intMaxMp;
  hero.hpRegen = atLevel(d.hpRegen, L) + s.hpRegen + s.str * A.strHpRegen;
  hero.mpRegen = atLevel(d.mpRegen, L) + s.mpRegen + s.int * A.intMpRegen;
  hero.moveSpeed = d.moveSpeed + s.moveSpeed;
  const p = d.primary;
  const attr = p === 'str' ? s.str : p === 'agi' ? s.agi : s.int;   // primary only (§2)
  hero.attackDamage = atLevel(d.attackDamage, L) + s.attackDamage + attr;
  hero.abilityAmp = s.abilityAmp + s.int * A.intAmp;
  hero.cdr = s.cdr > CDR_CAP ? CDR_CAP : s.cdr;
  let as = s.attackSpeedPct + s.agi * A.agiAttackSpeed;   // buffs stack on top (§2)
  if (as > ATTACK_SPEED_CAP) as = ATTACK_SPEED_CAP;
  hero.itemAttackSpeed = as;
  hero.lifesteal = s.lifesteal;
  hero.levelArmor = atLevel(d.armor, L);
  hero.itemArmor = s.armor + s.agi * A.agiArmor;
  refreshArmor(hero);
  if (hero.hp > hero.maxHp) hero.hp = hero.maxHp;
  if (hero.mp > hero.maxMp) hero.mp = hero.maxMp;
}

// Armor = level + items/agility + the strongest armor buff + Unyielding below the
// passive's HP threshold, total capped at 75%. Called when the buff is applied or
// expires, on stat changes, and once per frame from Hero.update.
export function refreshArmor(hero) {
  let a = hero.levelArmor + hero.itemArmor + hero.abilities.armorBuff;
  const passive = hero.data && hero.data.passive;
  if (passive && passive.kind === 'unyielding' && hero.hp / hero.maxHp < passive.threshold) {
    a += passive.bonus;
  }
  if (a > ARMOR_CAP) a = ARMOR_CAP;
  hero.armor = a;
}