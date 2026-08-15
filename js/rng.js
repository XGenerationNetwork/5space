/* 5Space - random number generation, vector maths, and small shared utilities.
 *
 * The RNG is a seeded xoshiro128** so that a saved game restores with an
 * identical random stream: the four state words go straight into the save
 * file.  All *world* randomness must go through here, never through
 * Math.random - but note that unlike a turn-based roguelike a real-time
 * simulation is not reproducible from a seed alone, because the player's
 * inputs arrive at wall-clock times.  The seed reproduces the *universe*
 * (sector layouts, enemy rosters, prize contents); it does not replay a
 * session.  Purely cosmetic randomness - explosion sparks, the starfield -
 * deliberately uses Math.random, so that drawing a frame never perturbs the
 * stream that the simulation depends on.
 */
(function (SS) {
  'use strict';

  function RNG(seed) {
    this.seed(seed === undefined ? (Date.now() ^ (Math.random() * 0x100000000)) : seed);
  }

  RNG.prototype.seed = function (s) {
    s = s >>> 0;
    if (s === 0) s = 0x9e3779b9;
    /* splitmix32 to spread a single seed word over the four state words */
    var x = s;
    function nxt() {
      x = (x + 0x9e3779b9) >>> 0;
      var z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    }
    this.s0 = nxt(); this.s1 = nxt(); this.s2 = nxt(); this.s3 = nxt();
    this.initialSeed = s;
    for (var i = 0; i < 12; i++) this.u32();
  };

  /* raw 32-bit unsigned draw (xoshiro128**) */
  RNG.prototype.u32 = function () {
    var s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3;
    var result = (Math.imul(Math.imul(s1, 5) >>> 0, 9) >>> 0);
    result = ((result << 7) | (result >>> 25)) >>> 0;
    result = Math.imul(result, 9) >>> 0;
    var t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
    this.s0 = s0; this.s1 = s1; this.s2 = s2; this.s3 = s3;
    return result;
  };

  /* uniform float in [0,1) */
  RNG.prototype.float = function () {
    return this.u32() / 4294967296;
  };

  RNG.prototype.getState = function () {
    return [this.s0, this.s1, this.s2, this.s3, this.initialSeed];
  };

  RNG.prototype.setState = function (st) {
    this.s0 = st[0] >>> 0; this.s1 = st[1] >>> 0;
    this.s2 = st[2] >>> 0; this.s3 = st[3] >>> 0;
    this.initialSeed = st[4] >>> 0;
  };

  SS.RNG = RNG;
  SS.rng = new RNG();

  /* ---- dice helpers ---------------------------------------------------- */

  /* The helpers coerce their arguments to non-negative integers; a fractional
     die count would otherwise make d()'s countdown loop forever, since `n--`
     never lands exactly on zero. */

  /* 0 .. n-1 */
  SS.rn2 = function (n) {
    n = Math.floor(n);
    if (!(n > 1)) return 0;
    return SS.rng.u32() % n;
  };

  /* 1 .. n */
  SS.rnd = function (n) {
    n = Math.floor(n);
    if (!(n > 1)) return 1;
    return (SS.rng.u32() % n) + 1;
  };

  /* n dice of x sides */
  SS.d = function (n, x) {
    n = Math.floor(n);
    if (!(n > 0)) return 0;
    var tmp = n;
    while (n--) tmp += SS.rn2(x);
    return tmp;
  };

  /* rn2(x) + y */
  SS.rn1 = function (x, y) { return SS.rn2(x) + y; };

  /* uniform float in [lo, hi) */
  SS.rnf = function (lo, hi) { return lo + SS.rng.float() * (hi - lo); };

  /* usually 1, occasionally larger - used for prize stacking */
  SS.rne = function (x, cap) {
    var n = 1;
    cap = cap || 5;
    while (n < cap && !SS.rn2(x)) n++;
    return n;
  };

  /* random element of an array */
  SS.pick = function (arr) {
    if (!arr || !arr.length) return null;
    return arr[SS.rn2(arr.length)];
  };

  /* in-place Fisher-Yates using the game RNG */
  SS.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = SS.rn2(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  /* pick from a list, weighted by weightOf(entry) (default entry.weight) */
  SS.pickWeighted = function (list, weightOf) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += weightOf ? weightOf(list[i]) : list[i].weight;
    if (total <= 0) return null;
    var r = SS.rn2(total);
    for (i = 0; i < list.length; i++) {
      r -= weightOf ? weightOf(list[i]) : list[i].weight;
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  };

  /* ---- scalar helpers -------------------------------------------------- */

  SS.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  SS.sgn = function (v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); };
  SS.lerp = function (a, b, t) { return a + (b - a) * t; };

  SS.capitalize = function (s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  SS.anArticle = function (s) {
    if (!s) return s;
    return ('aeiou'.indexOf(s.charAt(0).toLowerCase()) >= 0 ? 'an ' : 'a ') + s;
  };

  SS.plural = function (n, singular, pluralForm) {
    return n === 1 ? singular : (pluralForm || (singular + 's'));
  };

  SS.commify = function (n) {
    return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  /* m:ss for the play clock */
  SS.clockString = function (seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  /* ---- vector maths ---------------------------------------------------- */
  /* Positions and velocities are plain {x,y} objects in *tile* units.  One
     tile is 16 pixels, matching Continuum, and every setting quoted in pixels
     is divided by 16 on the way in. */

  SS.vec = function (x, y) { return { x: x || 0, y: y || 0 }; };

  SS.length2 = function (dx, dy) { return dx * dx + dy * dy; };

  SS.length = function (dx, dy) { return Math.sqrt(dx * dx + dy * dy); };

  SS.dist = function (a, b) { return SS.length(a.x - b.x, a.y - b.y); };

  SS.dist2 = function (a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  /* Clamp a body's velocity to a maximum magnitude, the way ShipController
     truncates to the ship's top speed every tick.

     This takes the whole body and names the velocity fields explicitly rather
     than taking a bare {x,y}: a ship carries position *and* velocity, and a
     generic vector helper handed the wrong pair of fields silently scales the
     ship's coordinates instead of its speed. */
  SS.truncateVelocity = function (body, max) {
    var len2 = body.vx * body.vx + body.vy * body.vy;
    if (len2 > max * max && len2 > 0) {
      var s = max / Math.sqrt(len2);
      body.vx *= s; body.vy *= s;
    }
    return body;
  };

  /* ---- headings -------------------------------------------------------- */
  /* Continuum stores orientation as a float in [0,1) and draws it as one of 40
     discrete rotations.  Zero points straight up and the sequence runs
     clockwise.  Weapons fire along the *discrete* heading, which is why aim at
     close range feels faintly quantised - that is faithful, not a bug. */

  var ROTATIONS = 40;
  SS.ROTATIONS = ROTATIONS;

  /* wrap an orientation into [0,1) */
  SS.wrapOrient = function (o) {
    o = o % 1;
    return o < 0 ? o + 1 : o;
  };

  /* orientation float -> discrete rotation index 0..39 */
  SS.orientToRotation = function (o) {
    return Math.floor(SS.wrapOrient(o) * ROTATIONS) % ROTATIONS;
  };

  var HEADINGS = [];
  for (var r = 0; r < ROTATIONS; r++) {
    var ang = (r / ROTATIONS) * Math.PI * 2;
    /* zero = up = (0,-1), increasing clockwise in screen coordinates */
    HEADINGS.push({ x: Math.sin(ang), y: -Math.cos(ang) });
  }
  SS.HEADINGS = HEADINGS;

  /* unit heading vector for a discrete rotation */
  SS.rotationToHeading = function (rot) {
    return HEADINGS[((rot % ROTATIONS) + ROTATIONS) % ROTATIONS];
  };

  /* unit heading for an orientation float, quantised the way the original
     quantises before it fires */
  SS.orientToHeading = function (o) {
    return HEADINGS[SS.orientToRotation(o)];
  };

  /* orientation float for a direction vector */
  SS.headingToOrient = function (dx, dy) {
    return SS.wrapOrient(Math.atan2(dx, -dy) / (Math.PI * 2));
  };

  /* signed shortest turn from orientation a to orientation b, in [-0.5, 0.5) */
  SS.orientDelta = function (a, b) {
    var d = SS.wrapOrient(b - a);
    return d > 0.5 ? d - 1 : d;
  };

  /* The orientation that *fires* closest to a wanted bearing.

     Because orientToRotation floors, an orientation anywhere in a bucket
     shoots along that bucket's lower edge.  Aiming at the bearing itself can
     therefore land you in the bucket below it and throw the shot a full
     rotation point wide.  Snapping to the middle of the nearest bucket puts
     the fired heading as close to the bearing as forty headings allow, which
     is at worst half a rotation point - 4.5 degrees. */
  SS.snapOrient = function (o) {
    var r = Math.round(SS.wrapOrient(o) * ROTATIONS) % ROTATIONS;
    return (r + 0.5) / ROTATIONS;
  };

  /* The heading a ship at this orientation will actually shoot along,
     expressed back as an orientation - i.e. what the gun sees, not what the
     pilot intended. */
  SS.firedOrient = function (o) {
    return SS.orientToRotation(o) / ROTATIONS;
  };

  /* ---- byte packing, used to keep saved sectors small ------------------- */

  SS.packBytes = function (u8) {
    var CHUNK = 0x8000, out = '';
    for (var i = 0; i < u8.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(out);
  };

  SS.unpackBytes = function (str, len) {
    var bin = atob(str);
    var u8 = new Uint8Array(len !== undefined ? len : bin.length);
    for (var i = 0; i < bin.length && i < u8.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };

  /* A sector holds 65536 tiles and the overwhelming majority are empty space,
     so tile arrays are run-length encoded before they are base64'd - the
     difference between a save that fits in localStorage and one that does not.
     Runs are [value, countLo, countHi], capped at 65535 per run. */

  SS.rleEncode = function (u8) {
    var out = [];
    var i = 0, n = u8.length;
    while (i < n) {
      var v = u8[i], run = 1;
      while (i + run < n && u8[i + run] === v && run < 65535) run++;
      out.push(v, run & 0xff, (run >> 8) & 0xff);
      i += run;
    }
    return SS.packBytes(new Uint8Array(out));
  };

  SS.rleDecode = function (str, len) {
    var raw = SS.unpackBytes(str);
    var out = new Uint8Array(len);
    var o = 0;
    for (var i = 0; i + 2 < raw.length && o < len; i += 3) {
      var v = raw[i], run = raw[i + 1] | (raw[i + 2] << 8);
      for (var k = 0; k < run && o < len; k++) out[o++] = v;
    }
    return out;
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
