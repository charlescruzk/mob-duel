// wireStartGate — click-to-play, pointer lock and the overlay's return when the lock
// drops. Opening the shop releases the lock on purpose, so that release must not
// re-raise the start overlay on top of the panel. Touch devices have no pointer
// lock: the tap itself is the gate (touch.active) and the game simulates freely.
export function wireStartGate(base, controller, shopPanel) {
  const { input, hud, audio, touch } = base;
  const overlay = document.getElementById('start-overlay');
  let started = false;
  const start = () => {
    if (!started) {
      started = true;
      if (overlay) overlay.classList.add('hidden');
    }
    controller.enabled = true;
    audio.unlock();
    if (!touch.active) input.requestPointerLock();
    hud.showReticle(!touch.active);
  };
  if (overlay) overlay.addEventListener('click', start);
  input.onLockChange = (locked) => {
    if (touch.active) return;
    if (!locked && started && overlay && !shopPanel.open) {
      overlay.classList.remove('hidden');
      controller.enabled = false;
    } else if (locked && overlay) {
      overlay.classList.add('hidden');
      controller.enabled = true;
    }
    hud.showReticle(locked || !started);
  };
  return start;
}
