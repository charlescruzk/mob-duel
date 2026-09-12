// Sim/view split (Phase 3 task 1): the simulation runs in Node with no DOM and no
// three; the view mirrors world membership into meshes.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function jsFiles(dir, out) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

export default async function ({ block, report, SETUP, ROOT }) {
  let simRunsInNode = false, simOutput = '';
  try {
    simOutput = execFileSync('node', [join(ROOT, 'scripts', 'simNode.mjs'), '10'], { encoding: 'utf8', timeout: 60000 });
    simRunsInNode = /SIM NODE: ok/.test(simOutput);
  } catch (e) { simOutput = String(e?.stdout || e); }
  const simFiles = jsFiles(join(ROOT, 'src', 'sim'), []);
  const threeHits = simFiles.filter((f) => /from\s+['"]three['"]/.test(readFileSync(f, 'utf8')));
  const domHits = simFiles.filter((f) => /\b(document|window)\.(getElementById|createElement|addEventListener|innerHTML)\b/.test(readFileSync(f, 'utf8')));
  report('split: the sim runs headless in Node and never imports three or touches the DOM', {
    simRunsInNode,
    noThreeInSim: threeHits.length === 0,
    noDomInSim: domHits.length === 0,
    simFileCount: simFiles.length,
    threeHits, domHits,
  });

  await block('split: unit views follow world membership', `(async () => {
    ${SETUP}
    const Minion = (await import('/src/sim/units/minion.js')).Minion;
    const V = g.fx.unitViews;
    const shown0 = V.visibleCount();
    const mn = W.add(new Minion('red', W, { x: 2, y: 0, z: 10 }, { ranged: false, wave: 0 }));
    step(0.1);
    r.viewBuiltOnAdd = !!mn.mesh && mn.mesh.visible === true && V.visibleCount() === shown0 + 1;
    r.viewMirrorsPosition = Math.abs(mn.mesh.position.z - mn.pos.z) < 1e-6 && Math.abs(mn.mesh.position.x - 2) < 1e-6;
    W.remove(mn); step(0.1);
    r.viewHiddenOnRemove = mn.mesh.visible === false && V.visibleCount() === shown0;
    W.add(mn); step(0.1);
    r.viewReusedOnReadd = mn.mesh.visible === true && V.list.length === V.views.size;
    W.remove(mn); step(0.1);
    // Projectile records carry a colour; the view mesh pool is index-aligned.
    const EV = g.fx.effectViews;
    r.effectPoolsAligned = EV.projectiles.length === g.effects.projectiles.length && EV.rings.length === g.effects.rings.length && EV.zones.length === g.effects.zones.length;
    r.simHasNoMeshFields = !('mesh' in g.effects.projectiles[0]) && !('mesh' in g.effects.rings[0]);
    return r;
  })()`);
}
