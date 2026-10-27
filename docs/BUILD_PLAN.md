# Build plan

Work through the phases in order. Each phase ends with something runnable and the checks listed.
It must cost nothing to run beyond the droplet Chris already pays for (see `CLAUDE.md`).

## Phase 0: Repo and tooling

- Git repo (GitHub) with `.gitignore` for Node and .NET, `.editorconfig`, and a licence (ask Chris).
- `src/client`: Vite + TypeScript (strict), ESLint, Prettier, Vitest. Vite dev server proxies
  `/hubs` (with WebSockets) to the ASP.NET Core server.
- `src/FlickFootball.Server`: ASP.NET Core empty web app on .NET 10, plus
  `tests/FlickFootball.Server.Tests` (xUnit).
- Vite builds into `src/FlickFootball.Server/wwwroot`; the server serves it with
  `UseDefaultFiles()` + `UseStaticFiles()` and `MapFallbackToFile("index.html")`.
- Root `README.md` with the run commands.

**Check:** `npm run dev` shows a canvas page; `dotnet run` serves the built page.

## Phase 1: Port the prototype to TypeScript (offline parity)

Split `prototype/flick-football.html` into modules without changing behaviour:

1. `engine/`: bodies, integrate, collide (with contact events), bounds, constants. Pure and
   deterministic given inputs; inject the random source so tests can seed it.
2. `rules/`: match state machine (phases `menu, aim, think, moving, block, blockthink, pause,
   replay, over`), turn/possession, fouls, three-flick lock, block flicks, restarts, shooting area,
   clock, half time and change of ends (`up(team)`), golden goal, stats, replay recorder.
3. `ai/`: attack and block planning, including the mirrored frame for the second half.
4. `render/`: pitch cache, figures, ball, aim, call-outs, banners, replay tag, flipped view.
5. `ui/`: side panel, club builder (one component used twice), pre-match card, full time, Cup
   bracket, settings persistence (migrate the prototype's `ff2_club` key).
6. `audio/`: tock, whistle, cheer, ooh, crowd.

Tests (Vitest), at minimum:
- A flick that hits the ball keeps possession; a miss passes it; the third consecutive flick locks the player.
- Opponent hit before the ball is a foul.
- A goal from outside the shooting area is disallowed and gives a goal kick; an own goal counts.
- Keeper touch over the line gives a corner; defender touch gives a corner; attacker touch gives a goal kick.
- After half time `up()` flips, and kick-off placement and goal-kick direction follow it.
- The computer flicks towards the correct goal in both halves.
- Keeper regression: with a seeded random source, corner shots score against Medium within the
  measured band (roughly 50–75%).

**Check:** side by side with the prototype, the feel is the same. Full friendly to full time on
desktop and phone width, and a Cup run to a result.

## Phase 2: Online with SignalR (host-authoritative)

- Server: `MatchHub`, `RoomRegistry` (in memory), C# DTO records, validation, rate limits, rejoin
  tokens, a hosted service for room expiry, the `/m/{code}` fallback. See `ONLINE_PROTOCOL.md`.
- Client: `net/` wrapper over `@microsoft/signalr` with automatic reconnect; the "Play a friend
  online" card (Create a match / Join with a code / match code with Copy and Share / Leave).
- Snapshot sending follows the Rates rules (on change, max 15 per second while moving).
- Reuse the prototype's guest renderer (eased positions, sounds from `fx`, overlays from the phase).
- Server tests: create/join/rejoin with token, spectator overflow, bad flick rejected, oversized
  state dropped, rooms expire, limits enforced.

**Check:** two browsers (one in a private window) play a full match; the guest refreshes and gets
their seat back; a third window watches.

## Phase 3: Deploy to the existing droplet

Add this site without touching anything else on the droplet.

- `dotnet publish -c Release -r linux-x64 --self-contained false` into `/var/www/flick-football`
  (or self-contained if the droplet lacks the .NET 10 runtime).
- `deploy/flick-football.service` (systemd): runs as a dedicated non-root user,
  `ASPNETCORE_URLS=http://127.0.0.1:5080` (pick a port no other site uses), `Restart=always`,
  `MemoryMax=300M` so it can't starve the other sites.
- `deploy/nginx/flick-football.conf`: a new server block for the chosen host name with WebSocket
  support, then `certbot --nginx -d <host>` for the certificate:

```nginx
# in the http block (once per server; skip if another site already defines it):
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    server_name flick.example.com;          # the chosen subdomain
    location / {
        proxy_pass         http://127.0.0.1:5080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

- App: `UseForwardedHeaders`, health endpoint `/healthz`, long cache headers for hashed Vite assets
  and no-cache for `index.html`, server GC off.
- `deploy/deploy.sh`: build client and server, rsync to the droplet, `systemctl restart
  flick-football`. Optionally a GitHub Actions workflow that builds and tests on push.
- **Domain:** start with a subdomain of a domain Chris already owns (one DNS A record to the
  droplet's IP). The host name only appears in the Nginx file and certbot command.

**Check:** public HTTPS URL; an online match between a phone on mobile data and a desktop; the
other sites on the droplet unaffected; `systemctl status` shows memory well under the cap.

## Phase 4: Installable web app (PWA)

- `vite-plugin-pwa`: manifest (name "Flick Football", theme colours from the design, icons 192/512
  plus maskable), service worker precaching the app shell so play against the computer works offline.
- "Install" button in the side panel when the browser offers it; on iPhone, a short tip to use
  Share → Add to Home Screen.
- Full-height layout and a portrait hint on phones.

**Check:** installable (Lighthouse); airplane mode still allows a friendly vs the computer.

## Phase 5 (optional, has costs): Store app

Only when Chris decides; store accounts cost money (Apple $99 a year, Google $25 once).

- `.NET MAUI Blazor Hybrid` shell on .NET 10, Android first. Bundle the built client inside the
  app (`wwwroot` in a `BlazorWebView`) so it works offline. Apple rejects thin website wrappers
  (App Store guideline 4.2), so don't just load the site.
- Native touches via a small JS ↔ .NET bridge: haptics on flicks and goals, the share sheet for
  match codes, saved club in `Preferences`, deep links for `/m/ABCDE`.

**Check:** Android build runs on a device, plays offline vs the computer, and joins an online match
created on the website.

## Later ideas (not scheduled)

- Server-authoritative matches (see ONLINE_PROTOCOL.md).
- A dedicated domain once it has players.
- A lobby of open matches; friendly leagues.
- Club badges, more shirt patterns, kit numbers.
- Accessibility: keyboard aiming, reduced-motion banners, colour-blind-safe aim colours.
