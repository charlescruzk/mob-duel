// buildFx — the per-match view bundle (particles, ability FX, damage numbers, rig
// animation, hit stop) shared by the local match (main.js) and the online match
// (online.js). `world` is whichever world the animator must walk: the sim's or the
// network mirror's. Hit stop slows only the view clocks.
import { ParticleSystem } from './fx/particles.js';
import { AbilityFx } from './fx/abilityFx.js';
import { DamageNumbers } from './hud/damageNumbers.js';
import { RigAnimator } from './fx/rigAnimator.js';
import { HitStop } from './fx/hitStop.js';
import { effects } from '../sim/hero/effects.js';

export function buildFx(base, world, hero) {
  const { engine, scene, camera, unitViews, effectViews, shotViews, audio, touch } = base;
  const particles = new ParticleSystem(scene, 3000);
  const abilityFx = new AbilityFx(particles, effects, camera, hero);
  const damageNumbers = new DamageNumbers(engine.camera);
  const rigAnimator = new RigAnimator(world);
  const hitStop = new HitStop();
  const fx = {
    particles, abilityFx, damageNumbers, rigAnimator,
    unitViews, effectViews, shotViews, hitStop, audio, touch,
    viewScale: 1,
    update(dt) {
      const vdt = hitStop.scaled(dt);
      fx.viewScale = vdt / (dt || 1);
      unitViews.update(); effectViews.update(); shotViews.update(vdt);
      abilityFx.update(vdt); rigAnimator.update(vdt); particles.update(vdt); damageNumbers.update(dt);
      touch.update(dt); audio.update(dt);
    },
    reset() { particles.reset(); abilityFx.reset(); damageNumbers.reset(); hitStop.reset(); audio.reset(); touch.reset(); },
  };
  return fx;
}
