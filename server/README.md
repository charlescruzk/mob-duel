# moba-duel match server

Node ≥ 22, built-in modules only. Runs the same simulation as the browser
(`src/sim/`) at 20 Hz per room, in a worker thread per room.

```bash
node server/index.mjs 8787          # or PORT=8787 node server/index.mjs
curl http://localhost:8787/health   # {"ok":true,"rooms":0,"players":0,"version":1}
```

## Playing against it

The client on GitHub Pages is https, so the socket must be **wss://**. Locally
(http://127.0.0.1:8090) plain ws works:

```
http://127.0.0.1:8090/index.html?server=ws://127.0.0.1:8787/ws&room=new&hero=lilit&solo=1
```

- `room=new` creates a room and prints its 4-letter code in the status line;
  a second player joins with `room=CODE`. `solo=1` starts at once against the bot.
- `hero=` picks your hero (bayani, oroku, kazane, lilit, ren, amihan).

## Hosting (pick one)

1. **Fly.io / Render / Railway free tier** — a Node service running
   `node server/index.mjs` with the platform's `PORT`; they terminate TLS, so the
   URL is `wss://<app>.<host>/ws`.
2. **Cloudflare Tunnel from the Mac** that already runs OpenClaw:
   `cloudflared tunnel --url http://localhost:8787` gives a `https://…trycloudflare.com`
   URL; use `wss://…trycloudflare.com/ws`.

The server URL is never hard-coded: pass `?server=` (the lobby remembers it).

## Trust model (docs/NETCODE.md)

Clients send intents only (movement, aim, ability/edge buttons, buy/sell/use
indices). `src/net/protocol.mjs` clamps every field. Cooldowns, gold, damage and
positions are resolved on the server; the browser mirrors snapshots.
