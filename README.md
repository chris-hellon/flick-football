# Flick Football

A table-football flicking game for the browser: top-down baize pitch, 11-a-side figures,
slingshot flicks, real possession rules, your own club and kit, a knockout cup, and online
matches against a friend with nothing to sign up for. A passion project, run on an existing
droplet at no extra cost.

## Status

- **Phase 1 done:** the game is ported to TypeScript in `src/client` (engine, rules, computer
  opponent, renderer, sound, club builder, Cup) and plays the same as the prototype offline:
  friendlies against the computer or a friend on one device, and the Cup.
- Next: online matches over SignalR (Phase 2), then deploying to the droplet (Phase 3).
  `docs/BUILD_PLAN.md` has the plan.
- `prototype/flick-football.html` is the original single-file version, kept as the reference for
  behaviour and feel. (Its online mode depends on claude.ai and is being replaced.)

## Run it

Needs Node 22+ and the .NET 10 SDK.

```bash
# client (Vite dev server on http://localhost:5173, proxies /hubs to the server)
cd src/client
npm install
npm run dev
```

```bash
# server (http://localhost:5080): serves the built client and, from Phase 2, /hubs/match
dotnet run --project src/FlickFootball.Server
```

Other commands, from `src/client`:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks and builds into `src/FlickFootball.Server/wwwroot` |
| `npm run test` | Vitest (tests live in `tests/client`) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

From the repo root, `dotnet test` runs the server tests (xUnit).

In development builds the app is on `window.flick` for poking at from the browser console
(`flick.match.phase`, `flick.match.world.ball`, and so on).

To see the production setup locally, run `npm run build` and then `dotnet run`: the server serves
the built page at http://localhost:5080.

## Docs

- `CLAUDE.md`: project context and rules for working on this repo.
- `docs/GAME_DESIGN.md`: rules, physics, AI, clubs, cup, UI decisions.
- `docs/ONLINE_PROTOCOL.md`: rooms, SignalR hub, validation, reconnects, limits.
- `docs/BUILD_PLAN.md`: phases and acceptance checks.

## Licence

Copyright Chris Hellon. All rights reserved; see `LICENSE`.
