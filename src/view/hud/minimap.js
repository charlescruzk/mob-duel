// Minimap — a strip along the lane (z axis) showing heroes, minions and structures.
// One canvas, redrawn every third frame; nothing allocates.
import { LANE_BOUNDS, TEAM_COLOR } from '../../sim/map/laneData.js';
import { ensureHudStyles } from './hudStyles.js';

export class Minimap {
  constructor(world, playerHero) {
    this.world = world; this.player = playerHero;
    this.frame = 0; this.drawnHeroes = 0; this.drawnUnits = 0;
    if (typeof document === 'undefined') return;
    ensureHudStyles();
    const hud = document.getElementById('hud');
    if (!hud) return;
    const c = document.createElement('canvas');
    c.id = 'minimap'; c.width = 520; c.height = 52;
    hud.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.colors = { blue: '#' + TEAM_COLOR.blue.toString(16).padStart(6, '0'), red: '#' + TEAM_COLOR.red.toString(16).padStart(6, '0') };
  }

  update() {
    if (!this.ctx) return;
    if ((this.frame++ % 3) !== 0) return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const zMin = LANE_BOUNDS.minZ, zMax = LANE_BOUNDS.maxZ;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, H * 0.35, W, H * 0.3);
    ctx.fillStyle = 'rgba(79,216,224,.5)';
    ctx.fillRect(W * 0.5 - 2, 0, 4, H);                    // the river
    const units = this.world.units;
    let heroes = 0, drawn = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive) continue;
      // Red base is at −Z: draw it on the right so "forward" for blue is rightward.
      const x = (1 - (u.pos.z - zMin) / (zMax - zMin)) * W;
      const y = H * 0.5 + (u.pos.x / 8) * H * 0.35;
      ctx.fillStyle = this.colors[u.team] || '#fff';
      if (u.kind === 'hero') { heroes++; ctx.beginPath(); ctx.arc(x, y, u === this.player ? 7 : 6, 0, Math.PI * 2); ctx.fill(); if (u === this.player) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); } }
      else if (u.kind === 'minion') { ctx.fillRect(x - 2, y - 2, 4, 4); }
      else if (u.kind === 'tower') { ctx.fillRect(x - 4, H * 0.5 - 8, 8, 16); }
      else { ctx.beginPath(); ctx.moveTo(x, H * 0.5 - 10); ctx.lineTo(x + 8, H * 0.5); ctx.lineTo(x, H * 0.5 + 10); ctx.lineTo(x - 8, H * 0.5); ctx.closePath(); ctx.fill(); }
      drawn++;
    }
    this.drawnHeroes = heroes; this.drawnUnits = drawn;
  }
}
