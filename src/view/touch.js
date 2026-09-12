// TouchControls — virtual joystick, look-drag, ability buttons, assisted aim for
// phones and tablets (docs/PHASE3.md §6). Writes into the same Input the keyboard
// path uses, so HeroController never knows the source. Phase 3 fills this in; until
// then it detects nothing and does nothing.
export class TouchControls {
  constructor(input, canvas) {
    this.input = input;
    this.canvas = canvas;
    this.active = false;       // true once a touch source is driving the game
  }
  update(dt) {}
  reset() {}
  dispose() {}
}
