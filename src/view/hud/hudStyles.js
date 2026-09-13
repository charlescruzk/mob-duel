// One shared <style> for the Phase 3 HUD pieces that build their own DOM (lobby,
// pause menu, result screen, enemy bars, minimap, kill feed). Injected once.
const CSS =
  '.lb-bar{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:18px;font:12px/1.4 monospace;color:#cfd3dc}' +
  '.lb-bar button,.pm-row button{font:700 12px/1 monospace;letter-spacing:.08em;padding:8px 12px;border:1px solid #3a4250;background:rgba(20,26,40,.9);color:#e8e6e0;cursor:pointer;border-radius:4px}' +
  '.lb-bar button.on{border-color:#3b6fd6;background:rgba(59,111,214,.25)}' +
  '.lb-bar input{font:12px/1 monospace;padding:7px 8px;border:1px solid #3a4250;background:#0f1320;color:#e8e6e0;border-radius:4px;width:260px}' +
  '.lb-bar input.code{width:70px;text-transform:uppercase;letter-spacing:.2em}' +
  '.lb-bar .lb-online{display:none;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}' +
  '.lb-bar.online .lb-online{display:flex}' +
  '.lb-hint{width:100%;text-align:center;color:#8f8d86;font-size:11px}' +
  '.pm-row{display:flex;gap:10px;margin-top:16px;align-items:center;justify-content:center;flex-wrap:wrap;font:11px/1 monospace;color:#8f8d86}' +
  '.pm-row input[type=range]{width:110px}' +
  '.pm-row .pm-touch{display:none}body.touch .pm-row .pm-touch{display:inline-block}' +
  '#result-screen{position:fixed;inset:0;z-index:12;display:none;align-items:center;justify-content:center;background:rgba(6,8,14,.78);color:#e8e6e0;font:13px/1.6 monospace}' +
  '#result-screen.show{display:flex}' +
  '#result-screen .rs-box{min-width:320px;padding:22px 28px;border:1px solid #3a4250;background:rgba(14,18,28,.96);text-align:center;border-radius:6px}' +
  '#result-screen .rs-title{font:700 34px/1.2 monospace;letter-spacing:.14em;margin-bottom:6px}' +
  '#result-screen .rs-title.win{color:#f2c84b}#result-screen .rs-title.loss{color:#ff6b6b}' +
  '#result-screen table{margin:12px auto;border-collapse:collapse}#result-screen td{padding:2px 12px;text-align:left}#result-screen td+td{text-align:right;color:#cfd3dc}' +
  '#result-screen .rs-btns{display:flex;gap:10px;justify-content:center;margin-top:8px}' +
  '#result-screen button{font:700 12px/1 monospace;letter-spacing:.08em;padding:9px 14px;border:1px solid #3b6fd6;background:rgba(59,111,214,.25);color:#e8e6e0;cursor:pointer;border-radius:4px}' +
  '.eb{position:absolute;left:0;top:0;width:56px;height:6px;margin-left:-28px;background:rgba(0,0,0,.55);border:1px solid rgba(0,0,0,.7);opacity:0;pointer-events:none;will-change:transform}' +
  '.eb i{display:block;height:100%;width:100%;transform-origin:left center;background:#e04c4c}' +
  '.eb.blue i{background:#4a8fe8}.eb.big{width:70px;height:8px;margin-left:-35px}' +
  '.eb.locked{border-color:#ffd36b;box-shadow:0 0 0 1px #ffd36b,0 0 8px rgba(255,211,107,.8);height:8px}' +
  '#minimap{position:absolute;right:20px;top:12px;width:260px;height:26px;border:1px solid #3a4250;background:rgba(10,14,22,.7);pointer-events:none}' +
  '#kill-feed{position:absolute;right:20px;top:46px;display:flex;flex-direction:column;gap:3px;align-items:flex-end;pointer-events:none;font:12px/1.4 monospace}' +
  '#kill-feed div{padding:2px 8px;background:rgba(10,14,22,.7);border:1px solid #3a4250;color:#e8e6e0;opacity:0;transition:opacity .3s}' +
  '#kill-feed div.show{opacity:1}#kill-feed b.blue{color:#4a8fe8}#kill-feed b.red{color:#e04c4c}';

export function ensureHudStyles() {
  if (typeof document === 'undefined' || document.getElementById('hud-extra-style')) return;
  const style = document.createElement('style');
  style.id = 'hud-extra-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}
