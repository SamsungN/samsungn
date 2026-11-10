/* bg-trout.js — a lone grey trout that swims across the page background every so often.
   Load with <script src="bg-trout.js"></script> AFTER theme.js, trout.js and sin-wave.js.
   Needs nothing in the HTML: it makes its own fixed canvas right after <canvas id="wave">, so the
   fish sits on the sine waves but behind all the page content, and does not move when you scroll.
   One trout at a time, seen from above, drawn as Bayer-dithered square dots like the hero trout.
   Each pass: it appears from a random edge, swims a gently curved path, and leaves off another
   edge (about PASS_S seconds). Then it waits GAP_MIN_S..GAP_MAX_S seconds and goes again.
   It never enters the hero trout box (window.getTroutBox from trout.js): paths are planned around
   it, and if scrolling moves the box into the fish, the fish fades out before touching it.
   Colors come from theme.js through window.siteTheme (inkSoft, mix). No animation under
   prefers-reduced-motion. */
(function () {
  'use strict';

  if (!window.siteTheme) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ------------------------------------------------------------------
     TUNING — everything you'll want to play with lives here.
     ------------------------------------------------------------------ */
  var LENGTH = 120;          // snout-to-tail length in px (same on every screen size)
  var FIRST_S = 3;           // seconds after load until the first fish
  var GAP_MIN_S = 5;         // wait between fish, counted from when one leaves the screen...
  var GAP_MAX_S = 10;        // ...random between these two
  var PASS_S = 5;            // target time for one pass, edge to edge (speed is kept inside the limits below)
  var SPEED_MIN = 140;       // px/s
  var SPEED_MAX = 200;       // px/s

  var OPACITY_NIGHT = 0.50;  // strongest opacity of a dot (0-1), dark theme
  var OPACITY_DAY = 0.50;    // ... and light theme

  // look: same dither as the hero trout
  var TILE_SIZE = 5;         // size of one cell in px
  var TILE_DOT = 1;          // size of one square dot in px
  var TILE_ALPHA_CUT = 23;   // how much of a cell the fish must cover (0-255) before any dot is drawn
  var BODY_HALF = 0.075;     // half the body width at its widest, as a fraction of LENGTH
  // dot density (0-1) of each shading band, outer flank -> middle of the back, plus the fins and tail
  var BAND_FRACS = [1.00, 0.74, 0.48, 0.24];
  var BAND_DENS  = [0.30, 0.48, 0.72, 0.92];
  var FIN_DENS = 0.90;
  var TAIL_DENS = 0.36;

  // swimming
  var WAVE_AMP = 0.065;       // tail sweep as a fraction of body length
  var WAVE_LEN = 1.1;       // wavelengths along the body
  var FREQ_MIN = 2.0;        // tail beats per second at SPEED_MIN
  var FREQ_MAX = 2.5;        // ... and at SPEED_MAX
  var MIN_TURN_RADIUS = 0.3; // tightest turn in body lengths; sharper random paths are thrown away

  // keeping clear of the hero trout box
  var BOX_FADE = 40;         // px over which the fish fades out as it nears the box (gone by the time it touches)
  var BOX_CLEARANCE = 62;    // px of room planned paths leave around the box

  var NODES = 26;            // slices along the body
  var BODY_END = 0.92;       // where the body ends and the tail begins (0 snout ... 1 tail tip)

  var PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ss(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // trout outline, same as the hero trout (s = 0 snout ... 1 tail tip) -> 0..1 of full width
  function bodyF(s) {
    if (s > BODY_END) return 0;
    if (s < 0.30) { var u = 1 - s / 0.30; return 0.36 + 0.64 * Math.sqrt(Math.max(0, 1 - u * u)); }
    var t = (s - 0.30) / (BODY_END - 0.30);
    return 0.17 + 0.83 * Math.pow(Math.cos(t * PI / 2), 1.15);
  }
  var HW = BODY_HALF * LENGTH;
  function hw(s) { return HW * bodyF(s); }

  // Bayer threshold matrix for an n x n cell, as ranks 0 .. n*n-1 (row-major); same as trout.js
  function bayerRanks(n) {
    var s = 1, m = [[0]], x, y, size, add = [[0, 2], [3, 1]];
    while (s < n) s *= 2;
    for (size = 1; size < s; size *= 2) {
      var m2 = [];
      for (y = 0; y < size * 2; y++) {
        m2.push([]);
        for (x = 0; x < size * 2; x++) {
          m2[y].push(4 * m[y % size][x % size] + add[Math.floor(y / size)][Math.floor(x / size)]);
        }
      }
      m = m2;
    }
    var list = [];
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) list.push({ i: y * n + x, v: m[y][x] });
    list.sort(function (a, b) { return a.v - b.v; });
    var out = new Array(n * n);
    for (var r = 0; r < list.length; r++) out[list[r].i] = r;
    return out;
  }

  /* ---------- canvases ---------- */
  var cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:0;display:block;';
  var waveEl = document.getElementById('wave');
  if (waveEl && waveEl.parentNode) waveEl.parentNode.insertBefore(cv, waveEl.nextSibling);   // right above the sine waves
  else document.body.insertBefore(cv, document.body.firstChild);
  var ctx = cv.getContext('2d');

  // small hidden canvas the fish is drawn into: one canvas pixel per cell, just big enough for the fish
  var fx = document.createElement('canvas');
  var fxctx = fx.getContext('2d', { willReadFrequently: true });
  var FX_CELLS = Math.ceil((2 * LENGTH) / TILE_SIZE) + 6;
  fx.width = FX_CELLS; fx.height = FX_CELLS;

  var w = 0, h = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function clearMain() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); }

  /* ---------- the hero trout box (viewport coords), or null ---------- */
  function getBox() { return window.getTroutBox ? window.getTroutBox() : null; }
  function rectDist(x, y, b) {
    var dx = Math.max(b.l - x, 0, x - b.r), dy = Math.max(b.t - y, 0, y - b.b);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ---------- path planning ----------
     A cubic curve from a point just off one edge to a point just off another edge. Its first and
     last handles point inward, so the fish always arrives from and leaves toward off-screen. Random
     side-offsets on the handles give it an S-curve. Candidates that skim a corner, turn too sharply
     or come near the trout box are thrown away. */
  var PATH_N = 140;
  var path = null;   // { x, y, c (cumulative length), total, t0x, t0y, t1x, t1y }

  function edgePoint(e, margin) {   // e: 0 top, 1 right, 2 bottom, 3 left -> point off that edge + inward normal
    var f = rand(0.12, 0.88);
    if (e === 0) return { x: w * f, y: -margin, nx: 0, ny: 1, tx: 1, ty: 0 };
    if (e === 1) return { x: w + margin, y: h * f, nx: -1, ny: 0, tx: 0, ty: 1 };
    if (e === 2) return { x: w * f, y: h + margin, nx: 0, ny: -1, tx: 1, ty: 0 };
    return { x: -margin, y: h * f, nx: 1, ny: 0, tx: 0, ty: 1 };
  }

  function planPath() {
    var margin = LENGTH + 60, box = getBox();
    for (var attempt = 0; attempt < 40; attempt++) {
      var e1 = Math.floor(Math.random() * 4);
      var e2 = (e1 + 1 + Math.floor(Math.random() * 3)) % 4;
      var A = edgePoint(e1, margin), B = edgePoint(e2, margin);
      var dist = Math.hypot(B.x - A.x, B.y - A.y);
      var k1 = dist * rand(0.25, 0.45), k2 = dist * rand(0.25, 0.45);
      var o1 = dist * rand(-0.25, 0.25), o2 = dist * rand(-0.25, 0.25);
      var P1x = A.x + A.nx * k1 + A.tx * o1, P1y = A.y + A.ny * k1 + A.ty * o1;
      var P2x = B.x + B.nx * k2 + B.tx * o2, P2y = B.y + B.ny * k2 + B.ty * o2;

      var xs = new Float64Array(PATH_N + 1), ys = new Float64Array(PATH_N + 1), cs = new Float64Array(PATH_N + 1);
      var i, ok = true, onScreen = 0;
      for (i = 0; i <= PATH_N; i++) {
        var t = i / PATH_N, u = 1 - t;
        xs[i] = u * u * u * A.x + 3 * u * u * t * P1x + 3 * u * t * t * P2x + t * t * t * B.x;
        ys[i] = u * u * u * A.y + 3 * u * u * t * P1y + 3 * u * t * t * P2y + t * t * t * B.y;
        if (i) cs[i] = cs[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
        if (xs[i] > 0 && xs[i] < w && ys[i] > 0 && ys[i] < h) onScreen++;
        if (box && rectDist(xs[i], ys[i], box) < BOX_CLEARANCE) { ok = false; break; }
      }
      if (!ok) continue;
      if (onScreen < PATH_N * 0.3) continue;                       // skims a corner: barely seen

      var total = cs[PATH_N], ds = total / PATH_N, minR = MIN_TURN_RADIUS * LENGTH;
      for (i = 2; i <= PATH_N; i++) {                              // turn tightness
        var a0 = Math.atan2(ys[i - 1] - ys[i - 2], xs[i - 1] - xs[i - 2]);
        var a1 = Math.atan2(ys[i] - ys[i - 1], xs[i] - xs[i - 1]);
        var da = Math.abs(a1 - a0); if (da > PI) da = TAU - da;
        if (da / ds > 1 / minR) { ok = false; break; }
      }
      if (!ok) continue;

      var t0 = Math.hypot(xs[1] - xs[0], ys[1] - ys[0]) || 1;
      var t1 = Math.hypot(xs[PATH_N] - xs[PATH_N - 1], ys[PATH_N] - ys[PATH_N - 1]) || 1;
      return {
        x: xs, y: ys, c: cs, total: total,
        t0x: (xs[1] - xs[0]) / t0, t0y: (ys[1] - ys[0]) / t0,
        t1x: (xs[PATH_N] - xs[PATH_N - 1]) / t1, t1y: (ys[PATH_N] - ys[PATH_N - 1]) / t1
      };
    }
    return null;
  }

  // position at distance s along the path (straight extensions before the start and after the end)
  var tmp = { x: 0, y: 0 };
  function pathAt(s) {
    var p = path;
    if (s <= 0) { tmp.x = p.x[0] + p.t0x * s; tmp.y = p.y[0] + p.t0y * s; return tmp; }
    if (s >= p.total) { var e = s - p.total; tmp.x = p.x[PATH_N] + p.t1x * e; tmp.y = p.y[PATH_N] + p.t1y * e; return tmp; }
    var lo = 0, hi = PATH_N;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (p.c[mid] <= s) lo = mid; else hi = mid; }
    var f = (s - p.c[lo]) / Math.max(p.c[hi] - p.c[lo], 1e-6);
    tmp.x = lerp(p.x[lo], p.x[hi], f); tmp.y = lerp(p.y[lo], p.y[hi], f);
    return tmp;
  }

  /* ---------- the fish ---------- */
  var N = NODES, D = LENGTH / (N - 1);
  var qx = new Float64Array(N), qy = new Float64Array(N);     // slice centers (with tail wave)
  var nx = new Float64Array(N), ny = new Float64Array(N);     // slice normals (sideways)
  var pass = null;   // { u, t, phase, speed, seen }

  function frames() {
    for (var i = 0; i < N; i++) {
      var a = i > 0 ? i - 1 : 0, b = i < N - 1 ? i + 1 : N - 1;
      var hx = qx[a] - qx[b], hy = qy[a] - qy[b], l = Math.sqrt(hx * hx + hy * hy) || 1;
      nx[i] = -hy / l; ny[i] = hx / l;
    }
  }

  // The head follows the path; every other slice sits where the head was a body-length-fraction ago,
  // so the whole body follows the same curve. The swim wave then pushes each slice sideways.
  function stepFish(dt) {
    var P = pass, i;
    P.t += dt;
    var sp = P.speed * (1 + 0.08 * Math.sin(P.t * 1.7));           // a little surge and glide
    P.u += sp * dt;
    P.phase += dt * TAU * lerp(FREQ_MIN, FREQ_MAX, clamp((P.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN), 0, 1));

    for (i = 0; i < N; i++) { var q = pathAt(P.u - i * D); qx[i] = q.x; qy[i] = q.y; }
    frames();
    var amp = WAVE_AMP * LENGTH;
    for (i = 0; i < N; i++) {
      var s = i / (N - 1), env = 0.12 + 0.88 * Math.pow(s, 1.8);
      var disp = amp * env * Math.sin(P.phase - s * TAU * WAVE_LEN);
      qx[i] += nx[i] * disp; qy[i] += ny[i] * disp;
    }
    frames();
  }

  // point at fraction s along the body, lat px to the side
  function pt(s, lat) {
    var f = clamp(s, 0, 1) * (N - 1), i = Math.min(N - 2, Math.floor(f)), r = f - i;
    return [
      lerp(qx[i], qx[i + 1], r) + lerp(nx[i], nx[i + 1], r) * lat,
      lerp(qy[i], qy[i + 1], r) + lerp(ny[i], ny[i + 1], r) * lat
    ];
  }

  function shadeStr(d) { var v = Math.round(255 * d); return 'rgb(' + v + ',' + v + ',' + v + ')'; }
  function fillPoly(g, pts, dens) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = shadeStr(dens);
    g.fill();
  }
  function bodyPoly(frac) {
    var pts = [], K = 34, i, s;
    for (i = 0; i <= K; i++) { s = BODY_END * i / K; pts.push(pt(s, hw(s) * frac)); }
    for (i = K; i >= 0; i--) { s = BODY_END * i / K; pts.push(pt(s, -hw(s) * frac)); }
    return pts;
  }

  // draws the fish as grey levels (grey = dot density) into g, in page px
  function paintFish(g) {
    var sg, L = LENGTH;
    for (sg = -1; sg <= 1; sg += 2) {
      fillPoly(g, [pt(0.19, sg * hw(0.19) * 0.8), pt(0.265, sg * hw(0.265) * 0.8), pt(0.345, sg * (hw(0.26) + 0.07 * L))], FIN_DENS);   // pectoral
      fillPoly(g, [pt(0.47, sg * hw(0.47) * 0.7), pt(0.52, sg * hw(0.52) * 0.7), pt(0.575, sg * (hw(0.5) + 0.045 * L))], FIN_DENS);     // pelvic
    }
    var ped = hw(0.86), span = 0.09 * L;
    fillPoly(g, [pt(0.86, ped), pt(1, span), pt(0.945, 0), pt(1, -span), pt(0.86, -ped)], TAIL_DENS);                                  // tail fork
    for (var b = 0; b < BAND_FRACS.length; b++) fillPoly(g, bodyPoly(BAND_FRACS[b]), BAND_DENS[b]);                                   // body: flank -> back
  }

  /* ---------- drawing: grey levels -> Bayer-dithered square dots ---------- */
  var tileN = 0, tileRanks = null;
  var PAD = 0.12 * LENGTH + 4;   // room around the slice centers for fins and tail

  function drawFish(box) {
    var T = TILE_SIZE, Dt = Math.max(1, TILE_DOT), n = Math.max(1, Math.floor(T / Dt)), n2 = n * n, i;
    if (n !== tileN) { tileN = n; tileRanks = bayerRanks(n); }

    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (i = 0; i < N; i++) {
      if (qx[i] < minx) minx = qx[i]; if (qx[i] > maxx) maxx = qx[i];
      if (qy[i] < miny) miny = qy[i]; if (qy[i] > maxy) maxy = qy[i];
    }
    minx -= PAD; miny -= PAD; maxx += PAD; maxy += PAD;
    var seenNow = maxx > 0 && minx < w && maxy > 0 && miny < h;
    if (seenNow) pass.seen = true;
    clearMain();
    if (!seenNow) return;

    // fade out near the hero trout box
    var fade = 1;
    if (box) {
      var md = 1e9;
      for (i = 0; i < N; i++) md = Math.min(md, rectDist(qx[i], qy[i], box));
      fade = ss((md - PAD) / BOX_FADE);
      if (fade <= 0) return;
    }

    // the grid is fixed to the page, so the fish slides across it
    var ox = Math.floor(minx / T) * T, oy = Math.floor(miny / T) * T;
    var wc = Math.min(FX_CELLS, Math.ceil((maxx - ox) / T) + 1), hc = Math.min(FX_CELLS, Math.ceil((maxy - oy) / T) + 1);
    fxctx.setTransform(1, 0, 0, 1, 0, 0);
    fxctx.clearRect(0, 0, fx.width, fx.height);
    fxctx.setTransform(1 / T, 0, 0, 1 / T, -ox / T, -oy / T);
    fxctx.lineJoin = 'round';
    paintFish(fxctx);
    fxctx.setTransform(1, 0, 0, 1, 0, 0);
    var d = fxctx.getImageData(0, 0, wc, hc).data;

    var st = window.siteTheme;
    ctx.globalAlpha = lerp(OPACITY_NIGHT, OPACITY_DAY, st.mix) * fade;
    ctx.fillStyle = 'rgb(' + st.rgb('inkSoft') + ')';
    ctx.beginPath();
    for (var cy = 0; cy < hc; cy++) {
      for (var cx = 0; cx < wc; cx++) {
        var p = (cy * wc + cx) * 4, a = d[p + 3];
        if (a < TILE_ALPHA_CUT) continue;
        var lit = (d[p] / 255) * (a / 255) * n2;                // grey level = density; edge cells light fewer dots
        if (lit <= 0) continue;
        var bx = ox + cx * T, by = oy + cy * T;
        for (var ty = 0; ty < n; ty++) {
          for (var tx = 0; tx < n; tx++) {
            if (lit > tileRanks[ty * n + tx]) ctx.rect(bx + tx * Dt, by + ty * Dt, Dt, Dt);
          }
        }
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // belt and braces: nothing is ever left inside the box
    if (box) ctx.clearRect(box.l, box.t, box.r - box.l, box.b - box.t);
  }

  /* ---------- scheduling ---------- */
  var timer = 0, raf = 0, last = 0;

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(startPass, ms);
  }
  function scheduleGap() { schedule(rand(GAP_MIN_S, GAP_MAX_S) * 1000); }

  function startPass() {
    timer = 0;
    if (document.visibilityState !== 'visible') return;
    path = planPath();
    if (!path) { schedule(1000); return; }                     // no clear route right now (e.g. small screen): try again soon
    var speed = clamp((path.total + LENGTH) / PASS_S, SPEED_MIN, SPEED_MAX);
    pass = { u: 0, t: 0, phase: rand(0, TAU), speed: speed, seen: false };
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function endPass() {
    pass = null; path = null;
    clearMain();
    scheduleGap();
  }

  function frame(now) {
    if (!pass) return;
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    stepFish(dt);
    drawFish(getBox());
    if (pass.u - LENGTH > path.total || (pass.seen && !isVisibleNow()) || pass.t > 30) { endPass(); return; }
    raf = requestAnimationFrame(frame);
  }

  // true while any part of the fish is on screen
  function isVisibleNow() {
    for (var i = 0; i < N; i++) if (qx[i] > -PAD && qx[i] < w + PAD && qy[i] > -PAD && qy[i] < h + PAD) return true;
    return false;
  }

  // hidden tab: stop everything; back again: start waiting for the next fish
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer); timer = 0;
      cancelAnimationFrame(raf);
      pass = null; path = null;
      clearMain();
    } else if (!timer && !pass) {
      scheduleGap();
    }
  });

  schedule(FIRST_S * 1000);
})();
