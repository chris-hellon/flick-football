# Game design

Everything here is taken from `prototype/flick-football.html`. When this file and the prototype
disagree, the prototype wins; fix this file.

## World and units

- Portrait pitch in world units: `W = 680`, `H = 1050`, centre `CX = 340`. y = 0 is the top goal line.
- Visible world rectangle: x from -50 to 730, y from -58 to 1108 (`VX0, VY0, VW = 780, VH = 1166`),
  scaled to fit the canvas and centred. Device pixel ratio capped at 2.
- Goals: width `GW = 150`, depth `GD = 30`. Posts are static circles of radius 5 at
  (CX ± GW/2, 0) and (CX ± GW/2, H).
- Markings: penalty box 403 × 165, six-yard box 183 × 55, spot at 110, centre circle radius 91.5,
  corner arcs radius 12, chalk line width 3.
- **Shooting area lines** (dashed, labelled "SHOOTING AREA") at y = 350 and y = 700.

## Bodies

| Body | Radius | Mass | Notes |
| --- | --- | --- | --- |
| Player | `RP = 15` | 3 | 10 outfield per side, ids 0–9 (home) and 10–19 (away) |
| Ball | `RB = 8` | 1 | tracks `spin` for drawing only |
| Keeper | `KR = 15` | infinite | kinematic, moves only along x on its goal line |
| Post | 5 | infinite | static |

## Physics

- Fixed sub-steps: each animation frame (dt capped at 0.05 s) runs **6 sub-steps**.
- Friction per body: speed `s` becomes `max(0, s - dec·dt) · (1 - lin·dt)`.
  Players `dec = 520, lin = 0.8`; ball `dec = 210, lin = 0.3`.
- Circle–circle collisions over all pairs: positional separation by inverse mass, then impulse with
  restitution `E = 0.8`. A collision with relative normal speed over 60 plays a "tock".
- Players are clamped to 34 units beyond the touchlines and bounce off that limit at 0.4.
- A flick ends when every mover is below speed 3, or after 9 seconds.
- **Flick input:** press on your player, drag back, release. The pull is measured from where the
  press started (the prototype measured from the player's centre, so pressing near a player's edge
  added up to 36 units of pull and a tiny drag gave a hard flick, worst at kick-off where the ball
  is touching the taker). The pull is measured on screen, not on the pitch: full power is a
  `FULL_PULL_PX` pull of 100 CSS px with a mouse or 150 with a finger, however big the pitch is
  drawn (the prototype measured pitch units, so on a phone, where the pitch is drawn at about 0.44
  px a unit, about 66 px — a centimetre of thumb — was already full power). That on-screen pull is
  converted to pull units, which the rest of this paragraph uses. Pull distance is capped at
  `MAXDRAG = 150`; power `pw = min(d,150)/150`; launch speed `v = 90 + pw^1.5 · (1500 - 90)`
  (`POWER_CURVE`; the prototype was linear, which made light touches too strong: a 30-unit pull
  went from 372 to 216, half a pull from 795 to 588, a full pull is still 1500), direction
  opposite to the drag. `MAXV = 1500`. Drags under 12 units cancel. The computer chooses speeds
  directly, so the curve doesn't change its play.

## Turn and possession rules

- The team in possession flicks. If the **flicked player touches the ball**, the team keeps the
  ball and flicks again. If it misses, possession passes to the other side.
- **Three in a row:** one player may not be flicked more than three times consecutively; it shows a
  dashed ring and the status line tells the player to pick a team-mate.
- **Foul:** if the flicked player hits an opponent before touching the ball, possession passes and
  the team's foul count goes up.
- **Block flicks (optional, off by default):** after each attacking flick that keeps the ball, the
  defending side may move one player. During it only defenders can be flicked; touching the ball, or
  knocking it out, puts the ball back where it was. The defending human can skip. The user found
  this confusing in play, so it stays opt-in.
- **Shooting area:** a goal counts only if the attacking touch happened inside the attacking third
  (the ball's position at the moment of touch is past the dashed line), or if it's an own goal
  (last outfield touch by a defender). Keeper touches never change whether a goal counts.
- Two last-touch values are tracked:
  - `last` (outfield players only) decides goals and own goals.
  - `touch` (outfield players and keepers) decides corners and throw-ins. This was a fix: keeper
    saves pushed behind must give a corner.

## Restarts

- **Out over the goal line, outside the goal mouth:** corner to the attackers if the defending side
  touched it last, otherwise goal kick. Corner ball 11 units in from both lines at the nearest corner (`RB + 3`).
- **Goal kicks are the keeper's kick** (changed after playtesting; the prototype put the ball at
  (CX, 75) for an outfield player). The keeper is centred on its line and the ball placed on the
  front edge of the goal area (`GOAL_AREA_D - RB - 2` from the end line). A human side may first
  move its keeper like a restart taker (press inside the dashed ring, not on a figure, and drag):
  within `PLACE_R` of the ball, on the pitch, and never upfield of the ball. It stays where it was
  put until the kick, then walks back onto its line at 160 units a second. Only that keeper can
  be flicked: drag back from the keeper and let go. The kick launches the ball directly at
  `KEEPER_KICK` (0.8) × the slingshot speed. It counts as a touch, so the kicking side keeps the
  ball. Outside the keeper's kick, keepers can't be flicked. The computer kicks to the most
  advanced, least-marked team-mate it can reach (`planKeeperKick`, `ballSpeedFor`).
- **The keeper gathers** a ball that comes to rest inside a goal area (the small box: 183 × 55,
  `GOAL_AREA_HW`, `GOAL_AREA_D`) after a flick that moved it, whoever played it there: "… keeper
  gathers the ball", then that side's keeper's kick. A ball that was already sitting there and
  wasn't moved isn't gathered. Fouls are judged first.
- **Over the touchline:** throw-in to the side that didn't touch it last, ball placed just inside.
- **Disallowed goal** (shot from outside the area): goal kick to the defenders, with a message.
- The **nearest outfield player** of the restarting side is moved behind the ball (offset
  RP + RB + 4 from the ball, away from the pitch centre; for goal kicks, towards their own goal),
  and other players overlapping that spot are pushed clear.
- **Moving the taker (throw-ins and corners, human side only):** until the restart is taken, the
  taker can be dragged anywhere within `PLACE_R` = 70 of the ball (a dashed ring shows it): no
  closer than touching the ball, no further off the pitch than `RUN_OFF`, never onto another
  figure. Press near the ball (not on a player) and drag; pressing the taker itself is still the
  slingshot. Added after playtesting: the automatic spot often left no useful angle.
- **Kick-off:** formations reset; the most advanced player of the kicking side stands just behind
  the ball on the halfway line. After a goal the conceding side kicks off.

## Match format and clock

- Options: two halves of 3 minutes, two halves of 5 minutes, first to 3 goals, first to 5 goals.
- The clock runs only while play is live (aiming, thinking, moving, block flick). It pauses for
  restarts, banners and replays.
- When time runs out mid-flick, the flick finishes first.
- **Half time:** whistle, banner "HALF TIME · score · change ends", then the **teams change ends**
  (`swapped = true`) and the side that didn't kick off first starts the second half. Everything
  that depends on direction uses `up(team)`: formations, keepers' goal lines, kick-off placement,
  goal-kick direction, shooting-area checks, shot detection and figure facing.
- **Golden goal** (Cup ties only): level at full time means the next goal wins.

## Keepers

Keepers are on rods (drawn as a grey rod back through the goal) and move automatically. They
re-read the ball every `delay` seconds; when the ball heads towards their goal they aim for the
predicted crossing point plus a random error of up to `err`. Otherwise they shade 40% of the way
towards the ball's x. They move at up to `speed`, clamped to the goal mouth less 12 each side.

| Keeper | speed | delay (s) | err |
| --- | --- | --- | --- |
| Human side (and both in online/two-player) | 120 | 0.18 | 14 |
| Computer, level `l` (0 to 2.5) | 85 + 21·l | 0.26 - 0.04·l | 26 - 6·l |

History: the first version read shots perfectly and was unbeatable ("impossible to score").
Measured after the fix: corner shots from about 300 units out score around 80% against the Easy
keeper and 63% against Medium; shots at the keeper are saved. Keep it beatable.
`tests/client/keeper.test.ts` guards this with a seeded run of 200 such shots (player flicked at
520 units/s, which reproduces those figures in the port: 80% Easy, 61% Medium) and requires Medium
to stay within 50–75%.

## Computer opponent

Difficulty level `l`: Easy 0, Medium 1, Hard 2. In the Cup, `l = clamp(diff + (rating - 2)·0.4 + round·0.2, 0, 2.5)`.

```
noise     = 0.15 · 0.47^l            aim error, radians (±)
pErr      = 0.20 · 0.5^l             power error (±fraction)
topK      = l < 0.7 ? 3 : l < 1.5 ? 2 : 1   picks randomly among the best K candidates
blockProb = min(1, 0.35 + 0.3·l)     chance of taking a block flick
```

**Attacking flick.** Planned in a frame where the computer attacks down the screen; in the other
half the board is mirrored while it thinks and the resulting velocity is reversed (`inAiFrame`).
1. Targets: if the ball is inside its shooting area, three shots at the goal (the corner away from
   the keeper is valued most); five forward targets 230 ahead; passes to team-mates ahead.
2. For each target and each of its players, the contact point is the spot behind the ball on the
   target line. Skip if the approach angle's cosine is under 0.55. Cost =
   `0.55·distance + 520·(1 - cos) + 700 if the path is blocked - target value`.
3. If the best cost is under 600, pick among the top K within 160 of the best. Speeds:
   `vb = sqrt(2·210·(D + (shot ? 60 : 0)))·1.22`, `vhit = vb / (1.39·cos)`,
   `v0 = sqrt(vhit² + 2·520·L)·1.12·(1 ± pErr)`, angle ± noise.
4. Otherwise nudge the nearest player at the ball, or move it goal-side if that would play the
   ball backwards.

**Block flick.** Moves the nearest player whose path stays clear of the ball to a point between the
ball and its own goal (up to 95 units from the ball); skips when the ball is far from its goal.

It shows its aim line for 0.75 s before flicking, so the human can see what's coming.

## Formations

Coordinates are for the home side attacking up; the away side mirrors them (x → W - x, y → H - y).

```
4-4-2   [110,880] [250,880] [430,880] [570,880] [120,730] [265,720] [415,720] [560,730] [265,625] [415,625]
4-3-3   [110,880] [250,880] [430,880] [570,880] [170,735] [340,750] [510,735] [120,640] [340,625] [560,640]
3-5-2   [170,880] [340,895] [510,880] [80,720] [210,745] [340,770] [470,745] [600,720] [265,630] [415,630]
5-3-2   [70,820] [195,880] [340,900] [485,880] [610,820] [170,735] [340,750] [510,735] [265,630] [415,630]
4-5-1   [110,880] [250,880] [430,880] [570,880] [80,715] [210,735] [340,760] [470,735] [600,715] [340,625]
4-2-3-1 [110,885] [250,885] [430,885] [570,885] [265,785] [415,785] [140,680] [340,690] [540,680] [340,625]
```

Forwards sit just outside the centre circle. "Usual" means the club's own default shape.

## Clubs

Each club: `name`, `code` (3 letters), `shirt`, `alt` (second colour), `pat`
(`solid | stripes | hoops | halves | sash`), `base` (dome colour), derived `baseDk` (base darkened
55%), `rim` (= alt), `gk` (keeper shirt: yellow if the shirt is green, else green), `head`,
`rating` (1–3, used by the Cup), `form` (usual formation).

Eight original clubs (keep these names; never real clubs):

| Club | Code | Kit | Usual | Rating |
| --- | --- | --- | --- | --- |
| Harbour Albion | HAR | red/white stripes | 4-4-2 | 3 |
| Northgate United | NGU | sky blue | 4-3-3 | 2 |
| Ironvale | IRV | claret/sky halves | 3-5-2 | 2 |
| Mekong Rangers | MEK | green/white hoops, white base | 4-4-2 | 2 |
| Kingsport Athletic | KAT | white, black sash | 4-2-3-1 | 3 |
| Ashby Town | ASH | amber/black stripes | 5-3-2 | 1 |
| Dunmore City | DUN | navy, gold rim | 4-3-3 | 3 |
| Redcliff Rovers | RCR | tangerine/black halves | 4-5-1 | 1 |

Exact hex values are in the prototype's `TEAMS` array.

**Club builder** (used for "Your club" and the custom opposition):
- Name (max 20 characters). The short code auto-fills when left empty: three or more words gives
  initials; two words gives the first letter plus the first two of the second ("Hightown Swifts" →
  HSW); one word gives its first three letters.
- Name suggestions: three chips built from `PLACES × SUFFIX` lists, plus "More names".
- Shirt pattern segmented control, three colour pickers (main, second, base).
- Ten colour schemes as round swatches (main | second halves, base as the ring); the active one is ringed.
- **Randomise** sets name, pattern and colours (60% from schemes, otherwise a random HSL pair).
  For the opposition it retries until the shirt is at least 110 apart (RGB distance) from yours.
- Live preview of an outfield figure and the keeper.

## Figures and drawing

- Domed base with a radial gradient (base to baseDk), rim ring at 66% radius, shoulders ellipse in
  the kit pattern, head, small highlight, drop shadow offset (3, 4).
- Figures face the goal their team attacks.
- Ball: off-white gradient with three dark dots that rotate with `spin`.
- Pitch: surround cloth, 14 mown stripes, a noise pattern for baize texture, chalk lines. Cached to
  an offscreen canvas on resize.
- Aim guide: dotted chalk line ahead plus an amber power arc around the player (blue for block
  flicks). The opponent's aim shows faded.
- Active side's players pulse with a chalk ring; hover is amber; a locked player has a dashed dark ring.

## Replays, banners, call-outs, sound

- Every flick records frames (positions of 20 players, 2 keepers, ball and spin) into a segment;
  the last two segments are kept (max 720 frames each). After a goal: banner for 1.7 s, then the
  replay plays at 0.55× with a red "REPLAY" tag. Tap or the Skip button ends it.
- Banners: GOAL!, HALF TIME, GOLDEN GOAL. Floating call-outs: SAVE, POST, WIDE (shots that miss by
  under 1.1 goal widths).
- Sound (Web Audio, starts after the first tap): tock on collisions, whistle (1 blast kick-off,
  2 half time, 3 with a long last blast at full time), cheer on goals, "ooh" on saves and near
  misses, low crowd ambience during play. A Sound on/off toggle.

## Stats (full-time card)

Shots (attacking touch inside the area with the ball heading goalwards faster than 120), on target
(goal, or a keeper touch during a shot), saves, possession (share of non-block flicks), flicks,
corners, fouls.

## The Cup

- Eight teams: your club plus seven of the eight originals, shuffled. Quarter-final, semi-final,
  final; straight knockout; draws after full time go to golden goal.
- Other ties are simulated: `p(win) = 0.5 + (ratingA - ratingB)·0.13`, scores 0–3, golden goal
  marked with `*`.
- Lose and the rest of the bracket is simulated to a champion. State is saved locally.
- Cup ties always use timed halves (the friendly format if timed, else 2 × 3 minutes).

## Results

- Every finished match the player took part in is kept **on this device** (`ff_results`, newest
  first, at most 200): friendlies vs the computer (with difficulty), two players on one device,
  Cup ties (with round), and online matches (as host or guest; spectators keep nothing). An online
  match the friend left and the computer finished is marked as such. Results are always from the
  player's side: "me" is their own club, whichever end they played.
- The Results tab shows the last five as W/D/L chips, the record by kind of match (P W D L GD,
  plus a total when there's more than one kind), Cups won, the recent matches (10, then "Show
  all"), and head to head against every club faced (grouped by name, most played first).
- No public leaderboard: without accounts, names aren't unique and the host reports the score, so
  a shared table could be faked or abused. Stored results are validated on load like settings.
- A guest who rejoins a match that already finished doesn't save it a second time.

## UI decisions from playtesting (keep them)

- Page opens on a **pre-match card on the pitch** ("Your club v Opponents", format, difficulty,
  formations, Kick off). Nothing runs until Kick off. Settings changes update the card.
- Side panel: the big primary button, then one menu with tabs **Play · Club · Cup · Results ·
  Rules** (the last tab used is remembered).
  - **Play** starts with **Play against: Computer · Same device · Online**. Computer and Same device
    show the opponents (with Randomise and the optional custom opposition builder); Computer adds
    difficulty. Online shows the join-by-code row, then the match code, copy/share, status and
    leave once a match exists. Below that, **Match settings**: shapes (no "their shape" online: the
    friend picks their own), length and block flicks (a guest only sees its own shape).
  - Leaving Online while in a match asks first. Joining by `/m/CODE` opens Play with Online chosen.
  - A dot on a tab: amber for a new result, green while an online match is live.
- The primary button and the pre-match card's button always show the same single action:
  Kick off / Restart match; **Create online match** (Online chosen, no match yet); **Waiting for
  your friend** (hosting, nobody joined: disabled, drawn outlined); **Your friend kicks off**
  (guest). After a settings change mid-match it reads "Kick off with these settings" and pulses.
- While hosting, the away side is "Your friend" until they join; the card shows the match code.
- **Commentary** (the status line) is a caption strip along the foot of the scoreboard, always two
  lines tall, so a long message never moves the pitch (it used to make the page jump on phones).
  Each new line fades in; a line too long for two lines steps down a size. The team-colour chip
  sits at its start and a round sound toggle at its end.
- Inputs have visible borders (34% chalk); focus is drawn inside the border (amber border plus
  inset ring) so a scrolling panel can't clip it.
- Long club names wrap between words, never mid-word.
- Two-player on one device ("Same device") alternates on the same screen.
- Look: a floodlit ground at night (deep green backdrop, light from the stands, fine grain), baize
  pitch, stadium scoreboard (amber digits). Display font Big Shoulders Display for headings, tabs,
  buttons and toggles (uppercase); body font Archivo for text and inputs. Overlays dim with a soft
  vignette, not a box. A deliberate single dark look.

## Local storage keys

The prototype used `ff2_mode, ff2_diff, ff2_away, ff2_fmt, ff2_blockOn, ff2_sound, ff2_form0,
ff2_form1, ff2_club, ff2_oppClub, ff2_cup`. The port uses the same names with an `ff_` prefix
(`src/client/src/ui/settings.ts`). On first load it copies any `ff2_` value that has no `ff_`
counterpart, so testers keep their club and settings. Stored values are validated on load.
`ff_results` (new in the port) holds the Results list.
