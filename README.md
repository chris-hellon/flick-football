# Flick Football

A table-football flicking game for the browser: top-down baize pitch, 11-a-side figures,
slingshot flicks, real possession rules, your own club and kit, a knockout cup, and online
matches against a friend with nothing to sign up for. A passion project, run on an existing
droplet at no extra cost.

## Status

- **Phase 1 done:** the game is ported to TypeScript in `src/client` (engine, rules, computer
  opponent, renderer, sound, club builder, Cup) and plays the same as the prototype offline:
  friendlies against the computer or a friend on one device, and the Cup.
- **Phase 2 done:** online matches against a friend over SignalR. Create a match, send the code or
  the `/m/CODE` link, and the friend joins with no account. Extra joiners watch. A refresh or a
  dropped connection takes the same seat back.
- **Phase 3 done:** live at https://flickfootball.com. `deploy/` holds the systemd service and the
  scripts that set up and deploy the app to the droplet; the website itself is made in Orbit (see
  Deploy below). To redeploy:
  `FLICK_SSH=root@157.230.35.0 FLICK_PORT=5002 FLICK_HOST=flickfootball.com SELF_CONTAINED=1 deploy/deploy.sh` GitHub Actions builds and tests every push.
- Next: an installable web app (Phase 4). `docs/BUILD_PLAN.md` has the plan.
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
# server (http://localhost:5080): serves the built client and the /hubs/match online hub
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

Online play needs both running: the Vite dev server forwards `/hubs` to the .NET server. To try it
on one machine, create a match in one browser window and join from a private window.

To see the production setup locally, run `npm run build` and then `dotnet run`: the server serves
the built page at http://localhost:5080.

## Deploy

One process on the existing droplet, on a loopback port, as its own user. The website in front of
it (Nginx reverse proxy, HTTPS, DNS) is made in Orbit; this repo only sets up and deploys the app,
and never edits Nginx or anything else on the droplet.

Needs on the droplet: rsync, and either the ASP.NET Core 10 runtime or `SELF_CONTAINED=1`.
Locally: Node 22+, the .NET 10 SDK and SSH access as a user with sudo.

1. First time, from the repo root (asks for your sudo password once). It adds the `flickfootball`
   user, `/var/www/flick-football`, the `flick-football` service on `127.0.0.1:5080`, and a sudo
   rule that lets you restart just that service, then deploys:

   ```bash
   FLICK_SSH=chris@<droplet> deploy/deploy.sh --setup
   ```

2. In Orbit, on the droplet's Websites tab: add the site (e.g. `flick.<your domain>`) as a
   **reverse proxy** to port **5080**, point the domain at the droplet, then enable HTTPS.
   Orbit's proxy passes the WebSocket upgrade through, which online play uses.
3. Every deploy after that (builds, tests, uploads, restarts, health-checks):

   ```bash
   FLICK_SSH=chris@<droplet> FLICK_HOST=flick.<your domain> deploy/deploy.sh
   ```

| Setting | Default | Meaning |
| --- | --- | --- |
| `FLICK_SSH` | (required) | `user@host` for SSH; that user owns `/var/www/flick-football` |
| `FLICK_PORT` | `5080` | Loopback port (the one Orbit proxies to); setup refuses one already taken |
| `FLICK_HOST` | | Public host name, for the HTTPS check at the end |
| `SELF_CONTAINED` | `0` | `1` bundles the .NET runtime (no runtime needed on the droplet) |
| `FLICK_RID` | `linux-x64` | `linux-arm64` for an ARM server |
| `SKIP_TESTS` | `0` | `1` skips lint and tests |

The service shows in Orbit's Services tab as `flick-football` (restart and logs there), memory is
capped at 300 MB, and `/healthz` answers `ok`. The host name lives only in Orbit's site, so moving
to another domain is done there.

## Docs

- `CLAUDE.md`: project context and rules for working on this repo.
- `docs/GAME_DESIGN.md`: rules, physics, AI, clubs, cup, UI decisions.
- `docs/ONLINE_PROTOCOL.md`: rooms, SignalR hub, validation, reconnects, limits.
- `docs/BUILD_PLAN.md`: phases and acceptance checks.

## Licence

Copyright Chris Hellon. All rights reserved; see `LICENSE`.
