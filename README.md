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
js/hud.js           messages, menus, prompts, touch controls
js/input.js         the keyboard
js/commands.js      the screens you can open mid-flight
js/save.js          serialisation
js/game.js          state, the 100 Hz loop, sector transitions, endgame
js/main.js          title screen and hull selection
test/headless.js    test harness
serve.js            static dev server
build.js            single-file bundler
```

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
- **input** — every way a key can go down under one set of modifiers and come
  up under another: WASD released while Shift is held, Caps Lock, both Shift
  keys, losing focus mid-turn, Ctrl+S versus a bare S, and one-shots firing
  once rather than once per frame
- **deploy** — every referenced asset is relative, exists, and loads from no
  other host; `.nojekyll` is present; the bundle is genuinely single-file
- **docs** — every key the game accepts is documented on the welcome page, and
  every key the page promises exists

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
