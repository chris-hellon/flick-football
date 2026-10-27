# Online protocol

Goal: anyone with the link can play a friend online. No accounts, no sign-in, no extra cost.

## How the prototype does it (to replace)

The prototype runs inside claude.ai and uses that platform's shared-room service
(`window.claude.use("room")`), which only admits signed-in users with access to the page. All of
that code (`net`, `ensureRoom`, `hostSend`, `onHostPeers`, `onGuestPeers`, `applyState`,
`guestFrame`) is replaced by a SignalR client. The **message shapes and the game logic around them
carry over**; only the transport changes.

Model in the prototype, kept for v1:

- **Host-authoritative.** The host's browser runs the simulation, rules, clock and replays, and
  sends state snapshots (the prototype every 40 ms; see Rates for production).
- The **guest** does not simulate. It draws the snapshots, easing positions towards each new target
  (`k = min(1, dt·18)`, snapping when the jump is over 120 units), plays the sounds listed in the
  snapshot, and sends its own inputs: flick, aim preview and skip block.
- **Spectators** are any further joiners; they render snapshots and cannot flick.
- The guest's view is rotated 180° so their side also attacks up the screen. Text is drawn upright
  (the `upright()` helper), and the "SHOOTING AREA" labels right-align in that view.
- The host's page keeps the match running in a background tab or a covered window. Browsers stop
  animation frames there, so while hosting a worker timer (`ui/ticker.ts`, every 50 ms) steps the
  match and publishes snapshots whenever no frame has run for 150 ms.
- After half time the teams change ends. The snapshot carries `sw` so the guest's figures face the
  right way.

## Rooms

- Match code: 5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I). Case-insensitive on input.
- Join link: `https://<site>/m/ABCDE` opens the page with the code filled in and joins on tap
  (server fallback route serves `index.html` for `/m/{code}`).
- In-memory registry (`Online/RoomRegistry.cs`, one lock around plain dictionaries; traffic is
  tiny). A hosted service runs every 30 s and closes rooms 2 minutes after the host drops, or after
  3 hours in total. The registry returns the messages to send instead of sending them, so it is
  unit-tested without SignalR.
- Seats: `host` (home, team 0), `guest` (away, team 1), then up to 8 `spectator`s.
- Each seat gets a random **rejoin token** (kept in sessionStorage as `ff_online`). Reconnecting
  with the token takes the same seat back, even with a new connection id. A dropped guest's seat is
  held for 2 minutes; after that someone else can take it.
- The room keeps the latest snapshot and both clubs, so a reconnecting guest or a new spectator
  sees the pitch at once.

## SignalR hub: `/hubs/match`

Client to server:

| Method | Who | Payload | Effect |
| --- | --- | --- | --- |
| `CreateMatch(club, form)` | anyone | `ClubDto`, formation | Creates a room. Returns `{ code, seat: "host", token }`. |
| `FindMatch(club, form)` | anyone | | "Play anyone": takes the guest seat in the longest-waiting public match whose host is connected, or opens a new public match (host seat). Returns a `JoinResult`. Public matches are ordinary rooms with a flag; they count towards the same limits. |
| `JoinMatch(code, club, form, token?)` | anyone | | Returns `{ ok, error, code, seat, token, otherClub, otherForm, otherPresent, lastState }`. Tells the host `GuestJoined(club, form)`. |
| `UpdateClub(club, form)` | host, guest | | Relayed to the other player (pre-match card updates live). |
| `PublishState(state)` | host | `StateDto` | Stored as latest; relayed to the guest and spectators. Dropped if over 8 KB. |
| `SendFlick(flick)` | guest | `{ n, id, vx, vy, b }` | Relayed to the host only. |
| `SendAim(aim?)` | host, guest | `{ id, vx, vy, b }` or null | Relayed to the other player. (The client's host sends its aim inside the snapshot's `am` instead.) |
| `SendSkip(n)` | guest | sequence number | Relayed to the host. |
| `SendPlace(place)` | guest | `{ id, x, y }` | Moves the guest's throw-in or corner taker. Relayed to the host only on the guest's turn; the host checks it's the current taker and applies the same limits as offline. At most 10 a second while dragging, plus the final spot. |
| `Leave()` | any | | Frees the seat; tells the others. |

Server to client: `GuestJoined`, `GuestLeft`, `HostLeft`, `HostReturned`, `ClubUpdated`, `State`,
`Flick`, `Aim`, `Skip`, `Place`, `RoomClosed(reason)`.

Recipients come from the registry's connection → seat map rather than SignalR groups, so a seat
taken back on a new connection needs no group bookkeeping. `OnDisconnectedAsync` marks seats empty
(not removed) until the grace period ends. Calls return `ok`/`error` results rather than throwing.

## DTOs

```ts
type ClubDto = { name: string; code: string; shirt: string; alt: string; base: string;
                 pat: "solid" | "stripes" | "hoops" | "halves" | "sash" };

type StateDto = {
  ph: "menu"|"aim"|"think"|"moving"|"block"|"blockthink"|"pause"|"replay"|"over";
  tn: 0|1; lk: number|null;           // turn, locked player id
  pt: number|null;                    // restart taker that can still be moved
  kb: 0|1|null;                       // side whose keeper has the ball (keeper's kick)
  sc: [number, number]; hf: 1|2|"gg"; cl: number;   // score, half, seconds left
  fmt: "t3"|"t5"|"g3"|"g5"; bl: 0|1; fo: [string, string]; sw: 0|1;
  p: number[];                        // 46 ints: x·10, y·10 for players 0–19, keepers 0–1, ball
  sp: number;                         // ball spin
  st: string; stt: 0|1;               // status line and its team colour
  k: [ClubDto, ClubDto];              // kits as the host sees them
  bn: { x: string; s: string; c: string; t: number } | null;   // banner
  fl: [string, number, number, number][];                     // call-outs: text, x, y, age
  am: { id: number; vx: number; vy: number; b: 0|1 } | null;  // host's aim preview
  fx: [number, "t"|"c"|"o"|"w", number, number][];            // last 6 sounds, numbered
  ft: number[][] | null;              // full-time stats rows when ph = "over"
};
```

Mirror these as C# records in the server for validation. Start with JSON; switch to the MessagePack
protocol later if bandwidth matters.

## Rates (keep the shared droplet happy)

- Send a snapshot only when something changed, at most **15 per second while bodies are moving**.
  No heartbeat: the server keeps the latest snapshot for anyone who reconnects. The guest's easing
  hides the lower rate.
- Aim previews at most 10 per second, and only while dragging.
- Never send per-frame data the guest can derive (banner and call-out ages tick locally).
- A match then moves roughly 1–2 MB an hour per viewer. A $6 droplet handles hundreds of
  concurrent matches long before memory runs out, but cap it anyway (below).

## Validation and limits

Treat everything from a peer as untrusted:

- Club: name trimmed, control characters stripped, max 20; code `[A-Z0-9]{0,3}`; colours
  `^#[0-9a-f]{6}$`; pattern from the list. Render names with `textContent`, never `innerHTML`.
- Formation must be one of the six keys.
- Flick: `id` must be one of the guest's players (10–19), or its keeper (21) for the keeper's kick, and not locked; `vx, vy` finite; speed
  clamped to 1500. Applied only when it is the guest's turn (or their block flick). Sequence
  numbers must increase.
- Snapshot arrays checked for length and finite numbers before use; unknown phases fall back to "pause".
- Server: snapshots over 8 KB of JSON are dropped; `MaximumReceiveMessageSize` is 10 KB so the
  envelope fits (SignalR closes the connection on anything bigger). Per-connection rate limits
  (host `PublishState` 20/s, others 15/s; up to 3× is dropped, beyond that the connection is
  closed); max 10 rooms per IP; max 500 rooms and 2,000 connections in total; ASP.NET Core rate
  limiting on `/hubs/match/negotiate` only (30 a minute per IP), because long polling makes a
  request per poll. All limits are in `MatchOptions` and can be set from the `Match` config section.
- The server also checks guest flicks against the last snapshot (whose turn, phase, locked player)
  before relaying them, and requires increasing sequence numbers for flicks and skips.

## Reconnects and leaving

- `withAutomaticReconnect([0, 1000, 3000, 5000, 10000])`, then `JoinMatch` with the token to take
  the seat back; the server replies with the latest snapshot.
- Guest drops mid-match: the host keeps the match; the status line says the friend left and can
  rejoin. After 60 s offer the host "Play on vs computer" (the computer takes the away side) or
  "End match".
- Host drops: the guest sees "Your friend has left". The room waits 2 minutes for the host's token.

## Later (optional): server-authoritative

To survive a host refresh and resist cheating, run the simulation on the server: port `engine/`
and `rules/` to a C# `FlickFootball.Engine` library (same constants), step each live room on the
server, and broadcast snapshots. Guard parity with golden tests: record flick inputs and resulting
positions from the TypeScript engine as JSON fixtures and assert the C# engine matches within a
small tolerance. Weigh the extra CPU against the shared droplet first.
