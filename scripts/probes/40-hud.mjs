// Menus and HUD polish (PHASE3.md §7): lobby, pause menu, result screen, enemy bars,
// minimap, kill feed. All DOM is built once; pools stay constant.
export default async function ({ block, restart, SETUP }) {
  await restart('');   // bare page: hero select + lobby, no match yet
  await block('hud: lobby renders both modes without starting a match', `(async () => {
    const r = {};
    const bar = document.querySelector('#hero-select .lb-bar');
    r.lobbyRendersModes = !!bar && bar.querySelectorAll('button').length >= 4;
    const online = bar ? bar.querySelectorAll('button')[1] : null;
    if (online) online.click();
    r.lobbyOnlineShowsServerField = !!bar && bar.classList.contains('online') && !!bar.querySelector('input');
    r.lobbyDoesNotStart = !window.__game;
    return r;
  })()`);
  await restart('hero=bayani&enemy=ren&lowfx=1');
  await block('hud: pause buttons, result screen, enemy bars, minimap, kill feed, pools constant', `(async () => {
    ${SETUP}
    const overlay = document.getElementById('start-overlay');
    const row = overlay ? overlay.querySelector('.pm-row') : null;
    r.pauseMenuBuilt = !!row && row.querySelectorAll('button').length >= 3;
    // A pause-menu button click must not count as the resume click.
    overlay.classList.remove('hidden');
    const before = g.controller.enabled;
    row.querySelectorAll('button')[1].click();          // SOUND toggle
    r.pauseButtonsDoNotResume = !overlay.classList.contains('hidden');
    r.pauseSoundToggles = g.fx.audio.muted === true;
    row.querySelectorAll('button')[1].click();
    overlay.classList.add('hidden');
    g.controller.enabled = before;
    // Enemy bar tracks the enemy's HP.
    E.teleport(H.pos.x, H.pos.z - 4); step(0.1);
    const bars = g.fx.enemyBars.bars;
    const eb = bars.find((b) => b.unit === E);
    r.enemyHpBarShown = !!eb && eb.el.style.opacity === '1';
    E.hp = E.maxHp * 0.5; step(0.05);
    r.enemyHpBarTracks = !!eb && Math.abs(eb._frac - 0.5) < 0.02;
    fresh(E);
    // Minimap draws both heroes.
    step(0.2);
    r.minimapShowsBothHeroes = g.fx.minimap.drawnHeroes === 2 && g.fx.minimap.drawnUnits >= 6;
    // Kill feed: the enemy dies to the player.
    const kf = g.fx.killFeed;
    const c0 = kf.count;
    E.takeDamage(1e9, H, 'true'); step(0.1);
    r.killFeedEntryOnKill = kf.count === c0 + 1 && kf.rows[0].b.textContent === E.data.name && kf.rows[0].a.textContent === H.data.name;
    // Result screen on match end, with the player's stats.
    const rs = g.fx.result;
    m.end('blue'); step(0.1);
    r.resultScreenShowsStats = rs.shown && rs.root.classList.contains('show') && rs.title.textContent === 'VICTORY' && rs.cells[1].textContent.indexOf('1 /') === 0;
    rs.hide(); m.reset(); m.skipCountdown();
    // 200 frames: no new DOM nodes, bar pool constant.
    const dom = document.querySelectorAll('*').length, pool = bars.length;
    step(10);
    r.hudPoolsConstant = document.querySelectorAll('*').length === dom && bars.length === pool;
    return r;
  })()`);
}
