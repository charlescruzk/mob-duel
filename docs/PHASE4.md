# PHASE4.md — multiplayer (server-authoritative, no dependencies)

`docs/NETCODE.md` made the decision: **the server runs the simulation at 20 Hz; clients
send intents and receive snapshots.** Phase 4 builds it. Prerequisite: Phase 3 §8, the
sim runs in Node with no `three` and no DOM.

## 1. Pieces

- **`server/index.mjs`** — Node, built-ins only. `node:http` serves nothing (the client
  is on GitHub Pages) and upgrades WebSocket connections by hand: `Sec-WebSocket-Accept`
  via `node:crypto` SHA-1, frame parsing and masking in `server/ws.mjs` (~150 lines:
  text and binary frames, ping/pong, close). Rooms in `server/rooms.mjs`: a 4-letter code,
  two seats, spectators optional later. Each room owns one `Match` from `src/sim/`
  ticked at 50 ms by a drift-corrected timer.
- **Protocol** (`src/net/protocol.mjs`, shared by client and server, JSON first, binary
  later if bandwidth demands): client → `{ t: 'join', room, hero }`, `{ t: 'intent',
  tick, i: HeroIntent }`; server → `{ t: 'joined', seat, tick }`, `{ t: 'start',
  heroes }`, `{ t: 'snap', tick, units: [...], heroes: [...], events: [...] }`,
  `{ t: 'over', winner }`. Snapshots every tick; delta compression against the last
  acked tick once JSON is measured too heavy.
- **Client** (`src/net/client.js`, `src/view/netView.js`): connects with `?server=wss://…`
  (or a saved setting), sends one intent per 50 ms with the tick number, keeps a 100 ms
  interpolation buffer for every remote unit, and runs **client-side prediction** for
  the local hero's movement only (re-simulate movement from the last acked snapshot
  through unsent intents; abilities, damage, gold are server-only and shown when the
  snapshot arrives). Reconciliation snaps if the error exceeds 0.5 m, else eases.
- **Lobby UI.** Title screen gains "Play online": create room (shows the code) or join
  by code; both pick heroes; the match starts when both are ready. Single-player versus
  the bot remains the default and needs no server.
- **Hosting.** The Pages client is https, so the server must be `wss://`. Options, in
  order of least effort: Fly.io or Render free tier running `node server/index.mjs`;
  or a Cloudflare Tunnel from the Mac that already runs OpenClaw. `server/README.md`
  documents both. The server URL is never hard-coded; `?server=` or the lobby field.

## 2. Determinism and trust
- The sim uses its own seeded RNG (already true) and integer tick counts; `Math.random`
  is forbidden in `src/sim/`.
- Server validates intents (booleans and clamped numbers only), rate-limits to one per
  tick, and ignores anything else. Nothing else is trusted.
- The bot can fill an empty seat so a room of one still plays.

## 3. Tasks
1. WebSocket server by hand (`server/ws.mjs`) with a Node test that opens a client with
   the built-in `WebSocket` and echoes. 2. Rooms and match ticking; a headless two-client
   test drives two intents and asserts both snapshots agree. 3. Protocol and client
   connection; the view renders from snapshots with interpolation (no prediction yet).
   4. Prediction and reconciliation for the local hero. 5. Lobby UI. 6. Delta snapshots
   and bandwidth measurement (target < 20 KB/s per client). 7. Hosting doc and a smoke
   test against the deployed URL. Each task: `npm run check`, `npm run probe`, the new
   Node tests under `scripts/`, commit.

## 4. Who builds it
Tasks 1, 5 and 7 are safe for a fast model. Tasks 2–4 and 6 touch timing, ordering and
prediction; a mistake there is silent (rubber-banding, desync) rather than a failing
assertion. Have a stronger model do them, or do them with a human in the loop.
