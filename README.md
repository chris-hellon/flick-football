# Flick Football

A table-football flicking game for the browser: top-down baize pitch, 11-a-side figures,
slingshot flicks, real possession rules, your own club and kit, a knockout cup, and online
matches against a friend with nothing to sign up for. A passion project, run on an existing
droplet at no extra cost.

## Status

- `prototype/flick-football.html` is a complete, playable single-file version. Open it in a
  browser to play friendlies and the Cup against the computer, or two players on one device.
  (Its online mode depends on claude.ai and is being replaced.)
- The production build (TypeScript client, ASP.NET Core + SignalR server on DigitalOcean behind
  Nginx, then an installable web app) follows `docs/BUILD_PLAN.md`.

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

To see the production setup locally, run `npm run build` and then `dotnet run`: the server serves
the built page at http://localhost:5080.

## Docs

- `CLAUDE.md`: project context and rules for working on this repo.
- `docs/GAME_DESIGN.md`: rules, physics, AI, clubs, cup, UI decisions.
- `docs/ONLINE_PROTOCOL.md`: rooms, SignalR hub, validation, reconnects, limits.
- `docs/BUILD_PLAN.md`: phases and acceptance checks.

## Licence

Copyright Chris Hellon. All rights reserved; see `LICENSE`.
