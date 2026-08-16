# 5Space

A roguelike with [SubSpace](https://en.wikipedia.org/wiki/SubSpace_(video_game))'s
flight model. Twenty-six procedurally generated sectors down, take the Prime Flag,
fly it back out. Dying is the end of the run.

Runs entirely in the browser. No build step, no dependencies, no server, and no
network requests once the page has loaded.

**[index.html](index.html) is the welcome page** — what the game is, how to play,
and the full control list. This file is the developer documentation.

```
      ·                    ▓▓▓▓                          ·
                          ▓▓▓▓▓▓         ◈                       ·
   ·        ▲                ▓▓             ╔══════╗
           ╱ ╲   ·                          ║ ····◇║      ·
     ·    ▼                        ·        ╠═╧══╧═╣
              ·        ▲you                 ║◇····◇║   ·
   ◇      ·                    ·            ╚══════╝
```

## Running it

```bash
node serve.js                       # http://localhost:8125
node serve.js 9000                  # a different port
node serve.js --root=..             # rehearse a GitHub Pages project subpath
node build.js                       # rebuild 5space.html, the single-file copy
node test/headless.js               # the full test suite
```

`play.html` also opens straight off the filesystem — the scripts are deliberately
classic non-module scripts, so `file://` works with no CORS problem.

## Deploying to GitHub Pages

The repository *is* the site. There is no build output to publish and no
framework to configure.

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment**, set *Source* to **Deploy from a
   branch**, pick your branch and the `/ (root)` folder, and save.
3. The site appears at `https://<user>.github.io/<repo>/` a minute later.

Everything is committed ready for that:

- **`index.html` is the welcome page**, so the repository root is the front door.
- **Every path is relative**, so the site works from a project subpath
  (`/<repo>/`) as well as from a domain root. This is the failure mode that is
  invisible until someone opens the deployed site, so the `deploy` test stage
  asserts it: every referenced asset is relative, exists on disk, and loads from
  no other host. `node serve.js --root=..` reproduces the subpath layout locally.
- **`.nojekyll` is present**, so Pages serves the files verbatim instead of
  running them through Jekyll.
- **No external requests at all** — no CDN, no fonts, no analytics. The page and
  the game work offline once loaded.
- **`5space.html` is committed on purpose.** It is the shareable single-file copy
  and it is served from the site. Rebuild it after changing any game source or it
  goes stale:

  ```bash
  node build.js
  ```

An optional [`.github/workflows/pages.yml`](.github/workflows/pages.yml) is
included for the Actions route instead. It runs the test suite and checks the
committed bundle is not stale before publishing, so a push that breaks sector
generation or the asset paths never reaches the site. To use it, set
**Settings → Pages → Source** to **GitHub Actions**.

## What this is

This is 5Hack's roguelike skeleton with SubSpace's body grafted onto it.
Everything structural that made the roguelike work is still here — persistent
procedurally generated levels, an objective at the bottom you must carry back to
the top, permadeath, a randomised progression you learn by playing — but the
moment-to-moment game is a 1997 top-down space shooter with momentum, and the
staircase is a warp portal.

| NetHack | 5Space |
|---|---|
| dungeon level | sector — a 256×256 tile map, generated once and kept |
| staircase down | warp portal (gold). The blue one goes back up |
| Amulet of Yendor | the Prime Flag, in a vault at the bottom of sector 26 |
| turn-based movement | real-time Newtonian flight at a fixed 100 Hz tick |
| hit points | energy — which is also your ammunition and your afterburner |
| unidentified potions | greens. Every prize looks the same until you take it |
| character class | hull. Eight of them, and the choice sticks for the run |
| levelling up | prizes, raising your handling toward the hull's ceiling |
| monsters | pilots, flying the same eight hulls under the same rules |
| the Amulet's hostility | carrying the Flag makes every sector hunt you |

## The physics are read, not approximated

The unit conversions are Continuum's, taken from the settings layout that
[nullspace](https://github.com/plushmonkey/nullspace) documents:

| Setting | Meaning |
|---|---|
| `MaximumRotation` | `rotation / 400` revolutions per second, over 40 discrete headings |
| `MaximumThrust` | acceleration is `thrust × 10/16` tiles/s² |
| `MaximumSpeed` | top speed is `speed / 160` tiles/s |
| `MaximumRecharge` | `recharge / 10` energy per second |
| `BulletSpeed` | pixels/second/10, so `speed / 160` tiles/s |
| `AfterburnerEnergy` | `value / 10` energy per second, the same scale as recharge |
| `Gravity` | pull is `(Gravity × 1000) / distance²`, in pixels |

The simulation ticks at 100 Hz because that is what a Continuum tick is, so a
setting quoted "per tick" means what it says.

That 40-heading detail matters more than it sounds. A shot aimed as well as the
hull allows can still be 4.5° off — a clean miss on a ship twenty tiles away —
and shots carry the shooter's own velocity out of the tube, so strafing throws
aim wide unless you compensate. Both are why SubSpace gunfights happen close, and
both had to be solved for the AI too: it leads targets in its own reference
frame and snaps to the middle of a firing bucket rather than at the raw bearing.

## Project layout

```
index.html          the welcome page (the GitHub Pages front door)
play.html           the game's page shell
5space.html         single-file build (node build.js)
.nojekyll           tells GitHub Pages to skip Jekyll
.github/workflows/  optional Actions deployment, gated on the test suite
css/style.css       overlay and menu styling
js/rng.js           seeded xoshiro128** RNG, vectors, headings, RLE
js/data/ships.js    the eight hulls and the arena settings
js/data/difficulty.js  Easy and Normal, as multipliers on eight levers
js/data/prizes.js   the 28 prize types and the roll tables
js/data/enemies.js  the pilot roster
js/sector.js        tiles and procedural sector generation
js/physics.js       movement, tile collision, bouncing, wormhole gravity
js/weapons.js       everything a ship can fire, drop or set off
js/ship.js          energy, handling, prizes, status, flight
js/enemyai.js       populating a sector, and flying the ships in it
js/radar.js         radar, map memory, and who can see whom
js/sprites.js       artwork, generated at startup
js/render.js        camera, starfield, world, radar, gauges
js/hud.js           messages, menus, prompts, on-screen controls
js/input.js         the keyboard
js/commands.js      the screens you can open mid-flight
js/save.js          serialisation
js/game.js          state, the 100 Hz loop, sector transitions, endgame
js/main.js          title screen and hull selection
test/headless.js    test harness
serve.js            static dev server
build.js            single-file bundler
```

## Difficulty

The two games this one is made of disagree about exactly one thing, and it is the
thing a difficulty setting should be about. SubSpace kills you constantly and does
not care: you respawn, you lose the prizes you were carrying, you go again. NetHack
kills you once. So the modes are not a damage slider — they are which ancestor is in
charge of dying.

| | |
|---|---|
| **Normal** | One hull, one run, permadeath. The game as designed. |
| **Easy** | A wing of five hulls. Losing one costs every green it had collected and drops the Prime Flag back into the Core, but the run continues. **More** pilots than Normal in the shallows, but far softer ones that start closer and notice you later. More greens and fewer bad ones. Scores count for half. |

It is the first question a new run asks, on both the "New run" and "random hull"
paths, and the title screen carries a `d` row showing the current mode so it can be
seen and changed without starting anything.

The whole table lives in [`js/data/difficulty.js`](js/data/difficulty.js) as
multipliers on eight levers — pilot count, build, skill, notice range and spawn
distance, green density, negative-green rate and reinforcement interval — plus the
number of hulls and a score multiplier.  Two of them (count and spawn distance)
are functions of sector depth rather than flat numbers.

**Easy fields more pilots than Normal, not fewer.**  The first version had 0.6x on
the reasoning that fewer enemies is easier, which is true and useless: a handful of
pilots scattered over 256 tiles is not gentle, it is *empty*, and you spend the run
hunting for something to practise on until the first real fight is the one you were
not ready for.  So the count goes up (1.6x at sector 1, tapering to 0.75x at the
Core) and the threat per pilot goes down — weaker builds, worse aim, and a much
shorter notice range, which is what turns a crowd into a queue of winnable single
fights rather than a crossfire.

**Every multiplier is 1 on Normal, and every one is applied *after* the random draw
it scales**, so a Normal run generates precisely the universe it did before the
setting existed. That is not obvious and it is easy to break: widening the green
clamp to make room for Easy's multiplier changed Normal's figure and shifted every
sector it generates. The `difficulty` test stage fingerprints Normal across sixteen
seed-and-depth combinations, interleaving an Easy generation between each pair, and
fails if any of them moves.

Measured with the balance autopilot (lower quartile of survival, 10 seeds):

| sector | Normal | Easy |
|---|---|---|
| 1 | 9 pilots, first fight 54s, 1.1 kills | 19 pilots, first fight 24s, 3.6 kills |
| 4 | 13 pilots, first fight 35s, 0.3 kills | 24 pilots, first fight 16s, 2.8 kills |
| 12 | 25 pilots, first fight 7s, 0.1 kills | 34 pilots, first fight 10s, 1.8 kills |

Runs ended in a three-minute window, out of ten: sector 1, **8 on Normal against 1
on Easy**; sector 4, 9 against 0; sector 12, 10 against 3. Easy still costs hulls —
1.4 of its 5 at sector 1 and 3.2 at sector 12 — it just does not end the run for
them, and it hands you three times the practice on the way.

Easy still costs hulls — the same autopilot burns 3.1 of its 5 in three minutes at
sector 18 — it just does not end the run for it.

## Touch

On anything reporting a touch screen, an on-screen control layer appears: a d-pad
under the left thumb, FIRE / BOMB / BOOST under the right, and a GEAR panel holding
the rest of the command set. `?touch=1` forces it on anywhere, which is how it gets
tested from a desktop; `?touch=0` forces it off.

Three things about it are less obvious than they look:

- **Pointer events with per-pointer tracking, not a listener per button.** A single
  press/release handler per button cannot express "this thumb slid from turn-left
  onto thrust", which is most of how anyone flies with a d-pad. A pointer stays
  tracked even while it is over nothing, so a thumb that wanders off the pad can
  wander back on.
- **Buttons name actions, they do not synthesise keys.** Half the command set is a
  modifier plus a key; a touch button that had to fake "Shift down, Tab down, Shift
  up" would be recreating a keyboard in order to talk to a keyboard parser.
- **BOOST is not Shift.** On a keyboard Shift+Ctrl is a repel, so holding Shift
  suppresses gunfire. On screen they are separate buttons under separate thumbs and
  holding both means both, so the on-screen boost carries its own name.

The renderer scales with the viewport: tile size drops on small screens so a phone
sees 34 tiles across its short axis rather than 23, and everything drawn in pixels
rather than tiles scales with it. The gauges and status readout keep out from under
the thumb pads — which sit in the *corners*, so in landscape the energy bar stays at
the bottom between them, and only in portrait does it climb above.

**Pause has to be leaveable by tap.** A held game keeps reading input - it is the
only reason a pause can be undone - and a tap or click anywhere on the game resumes
it, with buttons excluded so the on-screen Pause control does not toggle twice.

**A panel must not be closed by the click that opened it.** Both dismissal paths —
tapping a full-screen panel to continue, tapping a menu backdrop to cancel — are
listeners on the overlay, and the overlay is already under the pointer when they
are installed, so the trailing `click` of the opening gesture arrives at a listener
that did not exist when the press began. On a phone that made the menu button
useless (it opened and shut in one tap unless you slid your finger onto the box
first); on a desktop it made the ship readout, prize log and controls unreachable
from the menu. Presses are counted, a panel records the gesture it was born in, and
ignores that one. The overlay handler is also *owned* rather than merely added —
exactly one panel is visible at a time, and a listener left behind by an earlier one
kept cancelling whatever replaced it.

**Every prompt has to be answerable by tap.** A prompt blocks until it is answered,
so one that only listens for keystrokes is not awkward on a phone, it is a wall. The
name prompt drew its own caret and read intercepted keys, so nothing was focused, no
on-screen keyboard ever appeared, and a run could not be started at all; the
full-screen text panels waited on a keypress, which made the help, the readouts and —
worst — the death screen unrecoverable. So: text entry is a real focused `<input>`
(17px, because iOS zooms the page in on anything smaller), full-screen panels accept
a tap as the any-key, and tapping a menu's backdrop is the touch equivalent of Esc.

## Saving

Autosaves every twenty seconds, on every sector change, and whenever the tab is
closed or hidden. A save holds the RNG state, the hull with everything the greens
have done to it, and every sector generated so far — tiles, doors, radar memory,
greens, wrecks and pilots.

Getting that to fit in localStorage took three things: tile arrays are run-length
encoded (a sector is 65,536 tiles and mostly empty space), greens are stored as
bare tuples rather than objects, and pilots store only what the run has changed,
with everything derivable rebuilt from the roster on load. A completed 26-sector
run is about 830 KB, down from 2.1 MB before that work, and saves in 13 ms.

## Tests

```bash
node test/headless.js            # everything
node test/headless.js 30 gen     # one stage, bigger budget
node test/headless.js physics,save,deploy
```

The harness loads the game into Node behind a handful of browser stubs — the
script list comes out of `play.html`, so the two cannot drift apart — and checks:

- **gen** — sectors across many seeds: the objective *and every base room* are
  reachable from the spawn, and nothing is generated inside rock
- **determinism** — identical universes from identical seeds, different otherwise
- **physics** — the unit conversions, the forty headings, that the speed cap
  clamps velocity and leaves position alone, and that a body thrown at any speed
  in any direction never ends up inside a wall or outside the sector
- **prizes** — every prize on every hull, applied and un-applied, staying inside
  the hull's own range
- **enemies** — every pilot in the roster, built and flown
- **weapons** — every weapon fired, and every shot eventually expiring
- **save** — a round trip down to a hash of the tile map, each pilot's build, and
  the size of a full 26-sector run
- **descent** — the whole chain: down to the Core, take the Flag, back up, out
- **pilot / play** — that a naive autopilot can actually steer somewhere, and
  thousands of ticks of randomised input looking for exceptions and NaNs
- **balance** — a deliberately mediocre autopilot flown at sector 1 and sector 18,
  asserting the shallow end leaves room to learn and the deep end does not. In a
  real-time game a difficulty regression is silent; nothing throws when sector 1
  quietly becomes unsurvivable. It asserts on the *lower quartile* of survival
  time and on greens collected, not the median: survival is strongly bimodal —
  the autopilot either dies early or rides out the whole window — so the median
  jumps between the two humps with the sample size and makes for a flaky test
- **difficulty** — that Normal is bit-identical to the game before the setting
  existed, that Easy is gentler on every lever, that losing a hull resets it to
  factory and drops the Flag without ending the run, and that the mode and the
  hulls left survive a save
- **wormholes** — that no wormhole aims at a place a ship cannot leave under
  its own power, that sitting in one does not teleport you repeatedly, that
  pilots pass through instead of piling up in the well, and that one still
  flings you a long way with your momentum intact
- **pause** — that a held game keeps reading input, so P, Escape and the
  on-screen menu button still work; that weapons do not fire from it; and that
  there is a control for it on touch. Pausing was once a one-way trip: actions
  were dispatched only while the world was advancing, so pressing P froze the
  game and then ignored every key including P
- **input** — every way a key can go down under one set of modifiers and come
  up under another: WASD released while Shift is held, Caps Lock, both Shift
  keys, losing focus mid-turn, Ctrl+S versus a bare S, and one-shots firing
  once rather than once per frame
- **deploy** — every referenced asset is relative, exists, and loads from no
  other host; `.nojekyll` is present; the bundle is genuinely single-file
- **docs** — every key the game accepts is documented on the welcome page, and
  every key the page promises exists

The bug that motivated the **wormholes** stage came down to one invariant that
had never been written down: *a ship is never placed anywhere it cannot leave
under its own power*. A wormhole's pull follows Continuum's inverse-square law
and beats any hull's thrust inside about twelve tiles, so where a wormhole aims
is safety-critical — and each one was aimed at the exact centre of another
wormhole. Fly into one and you were thrown into the mouth of the next, pinned
by a pull no engine can out-thrust, and thrown back when the re-entry timer
expired: thirty-eight teleports in thirty seconds, indefinitely. Destinations
are now placed clear of every well and re-rolled on `WormholeSwitchTime`, the
re-arm is spatial rather than a countdown (a timer cannot help when the ship
has no way to get clear before it expires), and `randomOpenSpot` enforces the
invariant for every caller that places a ship, not just this one.

The bug that motivated the **input** stage is worth spelling out, because it is
easy to write again. `event.key` reports the *character produced*, not the key
pressed: a keydown on A reads `'a'`, but the matching keyup while Shift is held
reads `'A'`. A held-key map keyed on that never sees the release, so the key
sticks on — hold A to turn, press Shift to boost, let go of A, and the ship
turns forever. Caps Lock does the same thing, and arrow keys are immune, which
is how it survived play-testing. Held state is now keyed by `event.code`, the
physical key, which is the same on the way up as it was on the way down.

Bugs the suite caught while it was being written, all of them real: the speed cap
scaling the ship's position instead of its velocity (which read as a teleport to
the map origin), `newGame` leaving reinforcement timers set from the previous
run, the Core vault being stamped over a base and sealing its rooms, wall
openings written past the end of short walls, and bases buried by asteroid fields
with their doors opening into rock.

## Credits and differences

SubSpace was released by Virgin Interactive in 1997 and lives on as Continuum.
This is an independent implementation of its *mechanics*, written from the
documented settings and behaviour; it shares no code and no assets with the
original. Every sprite is drawn into a canvas at startup.

The settings vocabulary and physics conversions were read from
[plushmonkey/nullspace](https://github.com/plushmonkey/nullspace), with
[Subspace-Infinity](https://github.com/assofohdz/Subspace-Infinity) as a second
reference.

It is naturally smaller than either. There is no multiplayer, chat, teams or
frequencies, flag-capture scoring, LVZ objects, turreting, soccer, or zone list.
Ships do not collide with each other, which is faithful. What has been added is
everything on the roguelike side: permadeath, a persistent generated universe, an
objective to carry home, and a table of greens you have to learn.
