// Input — the ONLY module that listens to keyboard/mouse/pointer-lock events.
// Everything else reads its state. `endFrame()` must be called once per frame AFTER
// all readers, to clear the just-pressed set and the accumulated mouse delta.
// Keys are KeyboardEvent.code ('KeyW', 'Space', 'Digit1', ...).

export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this._just = new Set();
    this.mouseDown = [false, false, false];
    this._mouseJust = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.touchLook = false;      // set by TouchControls: look deltas arrive without pointer lock
    // Toggled when pointer lock changes; main.js uses it to show/hide the overlay.
    this.onLockChange = null;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      if (!this.down.has(e.code)) this._just.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => { this.down.delete(e.code); };
    this._onMouseDown = (e) => {
      if (e.button > 2) return;
      if (!this.mouseDown[e.button]) this._mouseJust[e.button] = true;
      this.mouseDown[e.button] = true;
    };
    this._onMouseUp = (e) => { if (e.button <= 2) this.mouseDown[e.button] = false; };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.releaseAll();
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._onBlur = () => this.releaseAll();
    this._onContext = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  isDown(code) { return this.down.has(code); }
  justPressed(code) { return this._just.has(code); }
  mouseJustPressed(button) { return this._mouseJust[button] === true; }
  anyMoveKey() {
    return this.down.has('KeyW') || this.down.has('KeyA') || this.down.has('KeyS') || this.down.has('KeyD');
  }

  requestPointerLock() {
    if (this.target && this.target.requestPointerLock) this.target.requestPointerLock();
  }

  exitPointerLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  // Stuck-key guard: losing focus or lock while a key is held would leave it "down".
  releaseAll() {
    this.down.clear();
    this._just.clear();
    for (let i = 0; i < 3; i++) { this.mouseDown[i] = false; this._mouseJust[i] = false; }
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  endFrame() {
    this._just.clear();
    for (let i = 0; i < 3; i++) this._mouseJust[i] = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
