# Flick Football

A table-football flicking game in the spirit of the classic tabletop game: top-down baize pitch,
11-a-side figures on domed bases, slingshot flicks, real possession rules. It started as a
single-file browser prototype (`prototype/flick-football.html`) that is fully playable today.
This repo turns it into a public website anyone can play, including online matches with no
account. It's a passion project with no budget: it runs on a DigitalOcean droplet Chris already
pays for, so it must stay light and add nothing to the bill.

## Read these first

| File | What it holds |
| --- | --- |
| `prototype/flick-football.html` | The working game. Source of truth for behaviour, feel and look until the port matches it. Open it in a browser to play. |
| `docs/GAME_DESIGN.md` | Rules, physics constants, computer opponent, keeper tuning, clubs, cup, replays, stats, UI decisions. |
| `docs/ONLINE_PROTOCOL.md` | Rooms, roles, SignalR hub contract, validation, reconnects, resource limits. |
| `docs/BUILD_PLAN.md` | Phased plan with acceptance checks. Work through it in order. |

## Architecture (decided)

```
flick-football/
  src/
    client/                    Vite + TypeScript. The game: engine, rules, AI, renderer, UI.
      src/engine/              Pure simulation: bodies, integration, collisions, events. No DOM.
      src/rules/               Turns, possession, fouls, restarts, shooting area, clock, ends.
      src/ai/                  Computer opponent (attack flick, block flick).
      src/render/              Canvas renderer (pitch cache, figures, aim, banners, replay).
      src/ui/                  Side panel, club builder, pre-match card, cup, full time.
      src/audio/               Web Audio effects (tock, whistle, cheer, ooh, crowd).
      src/util/                Maths, seeded random source, colour helpers.
      src/net/                 SignalR client wrapper (Phase 2+).
    FlickFootball.Server/      ASP.NET Core (.NET 10). SignalR hub, room registry, serves the client build.
    FlickFootball.App/         Optional, later: .NET MAUI Blazor Hybrid shell around the client build.
  tests/
    client/                    Vitest: engine and rules.
    FlickFootball.Server.Tests xUnit: room registry, hub validation.
  deploy/                      Nginx site config, systemd unit, deploy script.
  prototype/flick-football.html
  docs/
```

Hosting:

- **One process on Chris's existing DigitalOcean droplet**, alongside his other sites. ASP.NET Core
  serves the static client and the SignalR hub on the same origin, behind Nginx with a Let's Encrypt
  certificate. No database, no extra services, nothing paid.
- **Domain:** a subdomain of a domain Chris already owns to start (free), e.g. `flick.<his-domain>`.
  Keep the domain out of code: it lives in configuration and the Nginx file only, so moving to a
  dedicated domain later is a DNS change plus a new certificate.
- Keep memory small (the droplet is shared): in-memory rooms, server GC off
  (`<ServerGarbageCollector>false</ServerGarbageCollector>`), and a cap on rooms and connections.

Other decisions:

- **The game stays TypeScript** so one codebase runs in browsers, as an installable web app, and
  inside a native app shell later. Do not port the game to Blazor/C#: per-frame canvas drawing
  through JS interop is the wrong trade, and a WASM download hurts a game people open from a link.
- **.NET earns its place** in the server (SignalR rooms, hosting) and the optional MAUI shell.
- **Online v1 is host-authoritative** (the host's browser simulates; the server relays), exactly
  like the prototype. Server-side simulation is an optional later phase.
- **Mobile:** first as an installable web app (free). A store app is optional and later, because
  store accounts cost money (Apple $99 a year, Google $25 once).

## Non-negotiables

- **No "Subbuteo" anywhere** in names, UI, assets or listings (it is a Hasbro trademark). The game
  is called Flick Football. Clubs are original; never add real clubs, crests or kits.
- **Free to run.** Nothing that adds cost; light enough to share a droplet.
- **Behaviour parity first.** Port the prototype's numbers exactly (see GAME_DESIGN.md) before
  changing feel. Several values were tuned after the user complained (keeper, corners, ends).
- **Nothing starts until the player presses Kick off.** The page opens on a pre-match card.
- **The player always plays as their own club** ("Your club"). There is no separate team picker.
- **One obvious primary action** at any time (big Kick off button; pre-match card on the pitch).
- **Untrusted network input:** validate every field from peers (see ONLINE_PROTOCOL.md).

## Working style for this user

- Chris is an experienced .NET developer (ASP.NET Core, Blazor, EF, SQL Server) who also uses
  React, Vite and Tailwind, and runs DigitalOcean droplets with Nginx and SSL himself.
- Deliver complete, working code in one go. Never leave partial implementations, TODO stubs or
  "left as an exercise" gaps. Each phase ends runnable.
- Keep terminal sessions you start (dev servers, watchers) running and say they're still active,
  rather than telling him to close them.
- British English in UI copy ("colour", "Randomise", "kick off", "full time").
- Never touch his other sites on the droplet: only add this site's own Nginx file and service.

## Commands

```bash
# client
cd src/client && npm install && npm run dev        # Vite dev server (proxies /hubs to the server)
npm run test                                       # Vitest (specs in tests/client)
npm run lint                                       # ESLint; npm run format for Prettier
npm run build                                      # outputs to src/FlickFootball.Server/wwwroot (gitignored)

# server
dotnet run --project src/FlickFootball.Server      # http://localhost:5080: serves wwwroot + /hubs/match
dotnet test                                        # from the repo root (FlickFootball.slnx)
```

## Definition of done for any change

1. Builds with no warnings in new code; TypeScript strict.
2. Engine/rules tests pass; new rules get tests.
3. Played it: a full friendly vs the computer to full time, and (from Phase 2) an online match
   between two browser windows, including one reconnect.
4. Works at phone width (about 400px) and on desktop.
