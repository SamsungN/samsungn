/* trout.js — interactive trout for the hero section.
   Needs <div id="troutStage"></div> in the page. */

/* ============================ TROUT ENGINE ============================ */
(function (root) {
  'use strict';

  var PI = Math.PI, TAU = PI * 2;

  /* ------------------------------------------------------------------
     TUNING — everything you'll want to play with lives here.
     ------------------------------------------------------------------ */
  var CFG = {
    LENGTH: 130,           // snout-to-tail length in px
    NODES: 30,            // number of slices (more = smoother, finer banding)
    FOCAL: 820,           // perspective strength; lower = stronger depth effect

    // following the cursor (pure ease: the snout covers a fixed fraction of the remaining
    // distance each moment, so it is fast when far away and eases in as it arrives)
    EASE: 3.5,              // 1/s. higher = tighter on the cursor, lower = lazier / longer delay
    SIDE_VIEW_SPEED: 220, // snout speed (px/s) at which the body is seen mostly side-on.
                          //   slower = slices bunch up and it turns to face you; faster = fully flat
    FLATNESS: .7,       // how flat the body is at SIDE_VIEW_SPEED (0 = head-on, 1 = pure side view)
    REF_SPEED: 160,       // speed at which it is fully in "swimming" pose

    // activity box
    BOX_WIDTH: 0.78,      // fraction of viewport width used for the activity box
    BOX_MAX_WIDTH: 1000,  // maximum activity-box width in px
    BOX_HEIGHT_MIN: 180,  // minimum activity-box height in px
    BOX_HEIGHT_MAX: 280,  // maximum activity-box height in px
    BOX_HEIGHT_RATIO: 0.36,
    EASE_REF: 240,        // reference size for proportional easing
    BOX_GLOW_RANGE: 90,   // distance from wall over which the outline appears
    BOX_GLOW_LENGTH: 70,  // length of the visible wall segment

    // 3D pose
    UNFOLD_RATE: 1,      // how quickly it turns between head-on and side-on when it starts/stops (1/s)
    ROLL_RATE: 16,        // fastest the fish can roll about its own axis (rad/s)
    ROLL_EASE: 12,        // how eagerly it rolls toward showing its flank (1/s)
    ELEV: 0,              // view angle: 0 = pure side view, 1 = pure top-down

    // swimming motion
    WAVE_AMP: 0.025,      // tail sweep as a fraction of body length (small = stiff, calm swim)
    WAVE_FREQ_MIN: 1.5,   // tail beats per second when slow
    WAVE_FREQ_MAX: 3,   // ... and when fast
    WAVE_LEN: 1.05,       // wavelengths along the body
    BANK: 0,           // how much it rolls into turns

    // look
    BAND: 0.24,           // darkness of the lines between slices (0 = smooth)
    SLICE_STEP: 1         // draw every Nth slice's outline (1 = all)
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ss(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function angDiff(a, b) { var d = a - b; while (d > PI) d -= TAU; while (d < -PI) d += TAU; return d; }
  // rotate v by the rotation that carries unit vector a onto unit vector b (parallel transport)
  function rotTo(v, a, b, out) {
    var kx = a[1] * b[2] - a[2] * b[1], ky = a[2] * b[0] - a[0] * b[2], kz = a[0] * b[1] - a[1] * b[0];
    var sn = Math.sqrt(kx * kx + ky * ky + kz * kz), cs = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (sn < 1e-9) { out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; return out; }
    kx /= sn; ky /= sn; kz /= sn;
    var kv = kx * v[0] + ky * v[1] + kz * v[2];
    out[0] = v[0] * cs + (ky * v[2] - kz * v[1]) * sn + kx * kv * (1 - cs);
    out[1] = v[1] * cs + (kz * v[0] - kx * v[2]) * sn + ky * kv * (1 - cs);
    out[2] = v[2] * cs + (kx * v[1] - ky * v[0]) * sn + kz * kv * (1 - cs);
    return out;
  }

  /* ---------- colors (trout) ---------- */
  var RED = [184, 78, 70];   // toned-down red: belly, lower flank and lower fins
  var BODY_V = [ // dorsal -> ventral: dark back, grey flank, then red belly
    [0.00, [40, 40, 39]], [0.20, [66, 66, 64]], [0.42, [130, 130, 126]], [0.58, [178, 177, 171]],
    [0.74, [182, 132, 122]], [0.84, RED], [1.00, [198, 86, 76]]
  ];
  var BODY_L = [ // left flank -> back -> right flank (used when seen from above)
    [0.00, [184, 100, 92]], [0.10, [170, 166, 160]], [0.31, [108, 108, 105]], [0.50, [40, 40, 39]],
    [0.69, [108, 108, 105]], [0.90, [170, 166, 160]], [1.00, [184, 100, 92]]
  ];
  var LIGHT = (function () { var v = [-0.38, -0.62, -0.69], l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  
    /* ---------- day / night look ---------- */
  // Exposure: BASE brightens the whole fish; HIGHLIGHT pushes only the light colors toward white
  // (dark back barely moves, flank and belly lift most). Night was fixed at BASE 0.6, HIGHLIGHT 0.
  // Both fade with the theme. Raise DAY_* for a brighter fish in daylight.
  var EXPOSURE = {
    NIGHT_BASE: 0.64, DAY_BASE: 0.80,
    NIGHT_HIGHLIGHT: 0.10, DAY_HIGHLIGHT: 0.35
  };
  var DAY_RED = [176, 36, 52];     // trout's crimson in day (the night red stays [184, 78, 70])
  var DAY_V = [                    // day colors for each BODY_V stop (same order); only the reds differ
    [40, 40, 39], [66, 66, 64], [130, 130, 126], [178, 177, 171],
    [184, 112, 116], DAY_RED, [196, 44, 60]
  ];
  var DAY_L = [                    // day colors for each BODY_L stop (same order)
    [182, 66, 74], [170, 166, 160], [108, 108, 105], [40, 40, 39],
    [108, 108, 105], [170, 166, 160], [182, 66, 74]
  ];
  var FIN_RED_IDX = [1, 2, 3, 5];  // the red fins in FINS
  var SPECK_PALE_NIGHT = [214, 213, 206, 0.45], SPECK_PALE_DAY = [248, 247, 242, 0.6];
  var SPECK_RED_NIGHT = [214, 70, 58, 0.9], SPECK_RED_DAY = [190, 30, 48, 0.9];
    // night uses the same crimson as day
  RED[0] = DAY_RED[0]; RED[1] = DAY_RED[1]; RED[2] = DAY_RED[2];
  BODY_V[4][1] = DAY_V[4]; BODY_V[6][1] = DAY_V[6];
  BODY_L[0][1] = DAY_L[0]; BODY_L[6][1] = DAY_L[6];
  SPECK_RED_NIGHT = SPECK_RED_DAY;

  var lookV = BODY_V.map(function (s) { return [s[0], [0, 0, 0]]; });   // blended + lifted each frame
  var lookL = BODY_L.map(function (s) { return [s[0], [0, 0, 0]]; });
  var baseExp = 0.6, speckPale = '', speckRed = '';

  function siteMix() { return window.siteTheme ? window.siteTheme.mix : 0; }

  function lookStops(src, day, dst, mix, hl) {
    for (var i = 0; i < src.length; i++) {
      var a = src[i][1], b = day[i], o = dst[i][1];
      var r = a[0] + (b[0] - a[0]) * mix, g = a[1] + (b[1] - a[1]) * mix, bl = a[2] + (b[2] - a[2]) * mix;
      var lum = (0.3 * r + 0.59 * g + 0.11 * bl) / 255, k = hl * lum * lum;   // lights lift most, darks barely
      o[0] = r + (255 - r) * k; o[1] = g + (255 - g) * k; o[2] = bl + (255 - bl) * k;
    }
  }

  function mixRGBA(n, d, mix) {
    return 'rgba(' + Math.round(n[0] + (d[0] - n[0]) * mix) + ',' + Math.round(n[1] + (d[1] - n[1]) * mix) + ',' +
      Math.round(n[2] + (d[2] - n[2]) * mix) + ',' + (n[3] + (d[3] - n[3]) * mix).toFixed(3) + ')';
  }

  function updateLook() {
    var mix = siteMix(), E = EXPOSURE;
    var hl = lerp(E.NIGHT_HIGHLIGHT, E.DAY_HIGHLIGHT, mix);
    baseExp = lerp(E.NIGHT_BASE, E.DAY_BASE, mix);
    lookStops(BODY_V, DAY_V, lookV, mix, hl);
    lookStops(BODY_L, DAY_L, lookL, mix, hl);

    // red fins follow the shared red
    var r = lerp(RED[0], DAY_RED[0], mix), g = lerp(RED[1], DAY_RED[1], mix), b = lerp(RED[2], DAY_RED[2], mix);
    var lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255, k = hl * lum * lum;
    for (var i = 0; i < FIN_RED_IDX.length; i++) {
      FINS[FIN_RED_IDX[i]].color = [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k, 0.92];
    }

    speckPale = mixRGBA(SPECK_PALE_NIGHT, SPECK_PALE_DAY, mix);
    speckRed = mixRGBA(SPECK_RED_NIGHT, SPECK_RED_DAY, mix);
  }

  function rgb(c, f) {
    return 'rgb(' + clamp(Math.round(c[0] * f), 0, 255) + ',' + clamp(Math.round(c[1] * f), 0, 255) + ',' + clamp(Math.round(c[2] * f), 0, 255) + ')';
  }
  function rgba(c, f, a) {
    return 'rgba(' + clamp(Math.round(c[0] * f), 0, 255) + ',' + clamp(Math.round(c[1] * f), 0, 255) + ',' + clamp(Math.round(c[2] * f), 0, 255) + ',' + a + ')';
  }

  /* ---------- trout anatomy (s = 0 snout ... 1 tail tip) ---------- */
  var BODY_END = 0.92;
  function bodyF(s) {
    if (s > BODY_END) return 0;
    // blunt, rounded snout: a circular arc that starts already fairly wide, so no point at the tip
    if (s < 0.30) { var u = 1 - s / 0.30; return 0.36 + 0.64 * Math.sqrt(Math.max(0, 1 - u * u)); }
    var t = (s - 0.30) / (BODY_END - 0.30);
    return 0.17 + 0.83 * Math.pow(Math.cos(t * PI / 2), 1.15);
  }

  // Each fin returns [lat0, vert0, lat1, vert1] in px (a line across the slice), or null.
  // 'pair' fins are mirrored left/right.
  var FINS = [
    { pair: false, color: [52, 52, 51, 0.94], fn: function (s, Hm, h, w) {
      if (s < 0.37 || s > 0.50) return null;
      var u = (s - 0.37) / 0.13, hd = 0.52 * Hm * Math.pow(Math.sin(PI * u), 0.8) * (1 - 0.4 * u);
      return hd < 0.6 ? null : [0, h * 0.9, 0, h * 0.98 + hd];
    } },
    { pair: false, color: [RED[0], RED[1], RED[2], 0.92], fn: function (s, Hm, h, w) {
      if (s < 0.66 || s > 0.745) return null;
      var u = (s - 0.66) / 0.085, ha = 0.68 * Hm * Math.pow(Math.sin(PI * u), 0.8);
      return ha < 0.6 ? null : [0, -h * 0.9, 0, -(h * 0.98 + ha)];
    } },
    { pair: true, color: [RED[0], RED[1], RED[2], 0.92], fn: function (s, Hm, h, w) {
      if (s < 0.19 || s > 0.28) return null;
      var u = (s - 0.19) / 0.09, lp = 1.22 * Hm * Math.pow(Math.sin(PI * u), 0.8);
      return lp < 0.6 ? null : [w * 0.9, -0.42 * h, w * 0.9 + lp * 0.9, -0.42 * h - lp * 0.45];
    } },
    { pair: true, color: [RED[0], RED[1], RED[2], 0.92], fn: function (s, Hm, h, w) {
      if (s < 0.46 || s > 0.53) return null;
      var u = (s - 0.46) / 0.07, lp = 0.90 * Hm * Math.pow(Math.sin(PI * u), 0.8);
      return lp < 0.6 ? null : [w * 0.55, -0.88 * h, w * 0.55 + lp * 0.55, -0.88 * h - lp * 0.8];
    } },
    { pair: false, color: [84, 56, 54, 0.94], fn: function (s, Hm, h, w) {   // tail, upper lobe
      if (s < 0.86) return null;
      var u = clamp((s - 0.86) / 0.09, 0, 1), Y = Hm * (0.2 + 0.84 * ss(u));
      var yin = s > 0.925 ? 0.88 * Hm * 1.04 * Math.pow((s - 0.925) / 0.075, 1.15) : 0;
      return [0, yin, 0, Y];
    } },
    { pair: false, color: [RED[0], RED[1], RED[2], 0.92], fn: function (s, Hm, h, w) {   // tail, lower lobe
      if (s < 0.86) return null;
      var u = clamp((s - 0.86) / 0.09, 0, 1), Y = Hm * (0.2 + 0.84 * ss(u));
      var yin = s > 0.925 ? 0.88 * Hm * 1.04 * Math.pow((s - 0.925) / 0.075, 1.15) : 0;
      return [0, -yin, 0, -Y];
    } }
  ];

  var SPOT_ANGLES = [-76, -60, -44, -28, -12, 12, 28, 44, 60, 76, -92, -108, -124, 92, 108, 124];  // >=90 deg = lower flank
  var M = 12; // points per slice outline

  function convexHull(pts) {
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var n = pts.length, h = [], i, k = 0;
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    for (i = 0; i < n; i++) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], pts[i]) <= 0) h.pop();
      h.push(pts[i]);
    }
    var lower = h.length + 1;
    for (i = n - 2; i >= 0; i--) {
      while (h.length >= lower && cross(h[h.length - 2], h[h.length - 1], pts[i]) <= 0) h.pop();
      h.push(pts[i]);
    }
    h.pop();
    return h;
  }

  /* ------------------------------------------------------------------ */
  function Trout(ctx, opts) {
    var c = this.cfg = {};
    var k;
    for (k in CFG) c[k] = CFG[k];
    if (opts) for (k in opts) c[k] = opts[k];

    this.ctx = ctx;
    var N = c.NODES;
    this.N = N;
    this.px = new Float64Array(N); this.py = new Float64Array(N);
    this.dx = new Float64Array(N); this.dy = new Float64Array(N);
    this.rollN = new Float64Array(N);
    this.phi = new Float64Array(N);
    this.ax = new Float64Array(N); this.ay = new Float64Array(N); this.az = new Float64Array(N);
    this.qx = new Float64Array(N); this.qy = new Float64Array(N); this.qz = new Float64Array(N);
    this.T = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
    this.U = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
    this.Lt = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
    this.T2 = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
    this.U2 = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
    this.L2 = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];

    this.w = 800; this.h = 500;
    this.ease = c.EASE;
    this.setLength(c.LENGTH);
    this.reset(this.w / 2, this.h / 2);
  }

  Trout.prototype.setLength = function (L) { this.L = L; this.S = L / 240; };

  Trout.prototype.setEaseScale = function (smallDim) {
    this.ease = this.cfg.EASE * this.cfg.EASE_REF / Math.max(smallDim, 1);
  };

  Trout.prototype.reset = function (x, y) {
    this.hx = x; this.hy = y; this.time = 0;
    this.hist = [{ t: 0, x: x, y: y }];
    this.zc = new Float64Array(this.N);
    this.dH = [0, -1, 0]; this.tH = [0, 0, -1]; this.rollSide = 1; this.fcap = 0;
    this.sf = 0; this.phase = 0; this.omegaF = 0; this.omegaA = 0; this.rollHead = 0; this.spd = 0; this.speed = 0; this.ang = 0;
    for (var i = 0; i < this.N; i++) { this.px[i] = x; this.py[i] = y; this.rollN[i] = 0; this.zc[i] = i * this.L / (this.N - 1); }
  };

  Trout.prototype.setViewport = function (w, h) { this.w = w; this.h = h; };

  /* ---------------------- simulation ---------------------- */
  // The snout eases toward the cursor. Every other slice is simply the snout's own
  // recent past: slice i sits where the snout was (i x lag) seconds ago. So the body
  // always follows the exact path of the nose (curves, wiggles and all), and the faster
  // the nose moves the more the slices spread out, the slower it moves the more they
  // bunch up, which is what turns the fish to face the viewer when it stops.
  Trout.prototype.step = function (dt, tx, ty) {
    var c = this.cfg, N = this.N, S = this.S, L = this.L;
    dt = Math.min(dt, 0.05);

    // snout: pure ease toward the cursor
    var ox = this.hx, oy = this.hy;
    var k = 1 - Math.exp(-this.ease * dt);
    this.hx += (tx - this.hx) * k; this.hy += (ty - this.hy) * k;
    if (Math.abs(tx - this.hx) < 0.15 && Math.abs(ty - this.hy) < 0.15) { this.hx = tx; this.hy = ty; }
    var vx = (this.hx - ox) / Math.max(dt, 1e-4), vy = (this.hy - oy) / Math.max(dt, 1e-4);
    var speed = Math.sqrt(vx * vx + vy * vy);
    this.speed = speed; this.spd = speed;

    // record the snout's path
    this.time += dt;
    this.hist.push({ t: this.time, x: this.hx, y: this.hy });

    var D = L / (N - 1);
    var lag = D * c.FLATNESS / c.SIDE_VIEW_SPEED;      // seconds each slice trails the one in front
    // drop history older than the tail needs
    var oldest = this.time - (N + 2) * lag - 0.2, h = this.hist;
    while (h.length > 2 && h[1].t < oldest) h.shift();

    // the body unfolds from head-on to side-on at a limited rate, so starting to move never snaps the pose
    var fcT = ss(speed / (0.5 * c.SIDE_VIEW_SPEED));
    this.fcap += (fcT - this.fcap) * (1 - Math.exp(-c.UNFOLD_RATE * dt));
    var capL = D * Math.max(this.fcap, 0.02);

    // slice i = snout position (i x lag) seconds ago
    var j = h.length - 1;
    this.px[0] = this.hx; this.py[0] = this.hy;
    for (var i = 1; i < N; i++) {
      var tt = this.time - i * lag;
      while (j > 0 && h[j - 1].t >= tt) j--;
      var x, y;
      if (j === 0 || tt <= h[0].t) { x = h[0].x; y = h[0].y; }
      else {
        var a0 = h[j - 1], a1 = h[j], u = (tt - a0.t) / Math.max(a1.t - a0.t, 1e-6);
        x = a0.x + (a1.x - a0.x) * u; y = a0.y + (a1.y - a0.y) * u;
      }
      // never stretch past the body's real link length (or the current unfold limit)
      var ex = x - this.px[i - 1], ey = y - this.py[i - 1], d = Math.sqrt(ex * ex + ey * ey);
      if (d > capL) { x = this.px[i - 1] + ex * capL / d; y = this.py[i - 1] + ey * capL / d; d = capL; }
      this.px[i] = x; this.py[i] = y;
      // the body keeps a fixed 3D link length: whatever isn't spread sideways goes into depth
      this.zc[i] = this.zc[i - 1] + Math.sqrt(Math.max(D * D - d * d, 0));
    }
    this.zc[0] = 0;

    // ---- stable orientation: the fish keeps its own "which way is my back" between frames.
    // It is carried along as the body turns (no flips), and eases toward showing its flank
    // to the viewer, back up if possible. Straight up/down is no longer a special case.
    var k4 = Math.min(4, N - 1);
    var T = [this.px[0] - this.px[k4], this.py[0] - this.py[k4], this.zc[0] - this.zc[k4]];
    var tl = Math.sqrt(T[0] * T[0] + T[1] * T[1] + T[2] * T[2]) || 1;
    T[0] /= tl; T[1] /= tl; T[2] /= tl;
    var dH = rotTo(this.dH, this.tH, T, [0, 0, 0]);
    var dd = dH[0] * T[0] + dH[1] * T[1] + dH[2] * T[2];
    dH[0] -= dd * T[0]; dH[1] -= dd * T[1]; dH[2] -= dd * T[2];
    var dl = Math.sqrt(dH[0] * dH[0] + dH[1] * dH[1] + dH[2] * dH[2]) || 1;
    dH[0] /= dl; dH[1] /= dl; dH[2] /= dl;
    var el = c.ELEV, rv = [0, -Math.sqrt(1 - el * el), -el];
    var rt0 = rv[0] * T[0] + rv[1] * T[1] + rv[2] * T[2];
    var up = [rv[0] - rt0 * T[0], rv[1] - rt0 * T[1], rv[2] - rt0 * T[2]];      // screen-up, squared to the body
    var txy = Math.sqrt(T[0] * T[0] + T[1] * T[1]);
    var tg = [up[0], up[1], up[2]];
    if (txy > 1e-4) {
      var sd = [-T[1] / txy, T[0] / txy, 0];                                     // in-screen perpendicular = flank-on view
      var score = sd[0] * rv[0] + sd[1] * rv[1] + 0.5 * (sd[0] * dH[0] + sd[1] * dH[1] + sd[2] * dH[2]);
      if (Math.abs(score) > 1e-6) this.rollSide = score >= 0 ? 1 : -1;
      var aw = 0, sg = this.rollSide;
      tg = [(1 - aw) * up[0] + aw * sg * sd[0], (1 - aw) * up[1] + aw * sg * sd[1], (1 - aw) * up[2] + aw * sg * sd[2]];
    }
    var tgl = Math.sqrt(tg[0] * tg[0] + tg[1] * tg[1] + tg[2] * tg[2]);
    if (tgl > 1e-4) {
      tg[0] /= tgl; tg[1] /= tgl; tg[2] /= tgl;
      var cx_ = dH[1] * tg[2] - dH[2] * tg[1], cy_ = dH[2] * tg[0] - dH[0] * tg[2], cz_ = dH[0] * tg[1] - dH[1] * tg[0];
      var phi = Math.atan2(cx_ * T[0] + cy_ * T[1] + cz_ * T[2], dH[0] * tg[0] + dH[1] * tg[1] + dH[2] * tg[2]);
      var wUp = Math.sqrt(Math.max(0, 1 - rt0 * rt0));
      var dphi = wUp * clamp(phi * (1 - Math.exp(-c.ROLL_EASE * dt)), -c.ROLL_RATE * dt, c.ROLL_RATE * dt);
      var cs = Math.cos(dphi), sn = Math.sin(dphi);      // rotate dH about T by dphi
      var wx = T[1] * dH[2] - T[2] * dH[1], wy = T[2] * dH[0] - T[0] * dH[2], wz = T[0] * dH[1] - T[1] * dH[0];
      dH = [dH[0] * cs + wx * sn, dH[1] * cs + wy * sn, dH[2] * cs + wz * sn];
    }
    this.dH = dH; this.tH = T;

    // swim vs rest (drives tail beat)
    var sfT = ss((speed - 12 * S) / (c.REF_SPEED * S));
    this.sf += (sfT - this.sf) * (1 - Math.exp(-5 * dt));

    // bank into turns: from how fast the direction of travel changes
    var om = 0;
    if (speed > 25 * S) {
      var ang = Math.atan2(vy, vx);
      if (this.spd0 > 25 * S) om = clamp(angDiff(ang, this.ang) / Math.max(dt, 1e-4), -20, 20);
      this.ang = ang;
    }
    this.spd0 = speed;
    this.omegaF += (om - this.omegaF) * (1 - Math.exp(-8 * dt));
    var rt = clamp(this.omegaF * c.BANK, -0.9, 0.9) * this.sf;
    this.rollHead += (rt - this.rollHead) * (1 - Math.exp(-7 * dt));
    this.rollN[0] = this.rollHead;
    var kr = 1 - Math.exp(-14 * dt);
    for (i = 1; i < N; i++) this.rollN[i] += (this.rollN[i - 1] - this.rollN[i]) * kr;

    // tail beat
    var freq = lerp(c.WAVE_FREQ_MIN, c.WAVE_FREQ_MAX, this.sf);
    this.phase += dt * TAU * freq;
  };

  /* ---------------------- rendering ---------------------- */
  // builds tangent / dorsal / lateral axes for each slice from positions (x,y,z)
  Trout.prototype._frames = function (X, Y, Z, T, U, L) {
    var N = this.N, i, tmp = [0, 0, 0];
    for (i = 0; i < N; i++) {
      var a = i > 0 ? i - 1 : 0, b = i < N - 1 ? i + 1 : N - 1;
      var tx = X[a] - X[b], ty = Y[a] - Y[b], tz = Z[a] - Z[b];
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl < 1e-6) { tx = 0; ty = 0; tz = -1; tl = 1; }
      T[0][i] = tx / tl; T[1][i] = ty / tl; T[2][i] = tz / tl;
    }
    // dorsal direction: seeded from the head's persistent orientation, then carried slice to slice
    var d = [this.dH[0], this.dH[1], this.dH[2]];
    for (i = 0; i < N; i++) {
      var t = [T[0][i], T[1][i], T[2][i]];
      if (i > 0) { rotTo(d, [T[0][i - 1], T[1][i - 1], T[2][i - 1]], t, tmp); d = [tmp[0], tmp[1], tmp[2]]; }
      var dp = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
      var ux = d[0] - dp * t[0], uy = d[1] - dp * t[1], uz = d[2] - dp * t[2];
      var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (ul < 1e-6) { ux = 0; uy = -1; uz = 0; ul = 1; }
      ux /= ul; uy /= ul; uz /= ul;
      d = [ux, uy, uz];                                   // carried (without bank roll)
      var lx = t[1] * uz - t[2] * uy, ly = t[2] * ux - t[0] * uz, lz = t[0] * uy - t[1] * ux;
      var r = this.rollN[i];
      if (r) {                                            // bank into turns (output only)
        var cs = Math.cos(r), sn = Math.sin(r);
        var nux = ux * cs + lx * sn, nuy = uy * cs + ly * sn, nuz = uz * cs + lz * sn;
        ux = nux; uy = nuy; uz = nuz;
        lx = t[1] * uz - t[2] * uy; ly = t[2] * ux - t[0] * uz; lz = t[0] * uy - t[1] * ux;
      }
      U[0][i] = ux; U[1][i] = uy; U[2][i] = uz;
      L[0][i] = lx; L[1][i] = ly; L[2][i] = lz;
    }
  };

  Trout.prototype.draw = function () {
    var ctx = this.ctx, c = this.cfg, N = this.N, L = this.L, F = c.FOCAL * this.S;
    var hx = this.hx, hy = this.hy, i, j, k;
    updateLook();

    // 1) 3D spine: planar chain + depth that grows toward the tail
    for (i = 0; i < N; i++) { this.ax[i] = this.px[i]; this.ay[i] = this.py[i]; this.az[i] = this.zc[i]; }
    this._frames(this.ax, this.ay, this.az, this.T, this.U, this.Lt);

    // 2) swim wave along each slice's lateral axis
    var amp = c.WAVE_AMP * L * Math.pow(this.sf, 0.85);
    for (i = 0; i < N; i++) {
      var s = i / (N - 1), env = Math.pow(s, 1.5);
      var disp = amp * env * Math.sin(this.phase - s * TAU * c.WAVE_LEN);
      this.qx[i] = this.ax[i] + this.Lt[0][i] * disp;
      this.qy[i] = this.ay[i] + this.Lt[1][i] * disp;
      this.qz[i] = this.az[i] + this.Lt[2][i] * disp;
    }
    this._frames(this.qx, this.qy, this.qz, this.T2, this.U2, this.L2);
    var Ux = this.U2[0], Uy = this.U2[1], Uz = this.U2[2];
    var Lx = this.L2[0], Ly = this.L2[1], Lz = this.L2[2];
    var Qx = this.qx, Qy = this.qy, Qz = this.qz;

    function projX(x, zz) { return hx + (x - hx) * (F / (F + zz)); }
    function projY(y, zz) { return hy + (y - hy) * (F / (F + zz)); }

    var Hm = 0.105 * L;
    var prims = [];

    // 3) per-slice size
    var bH = new Float64Array(N), bW = new Float64Array(N), lastBody = 0;
    for (i = 0; i < N; i++) {
      var si = i / (N - 1), f = bodyF(si);
      bH[i] = Hm * f; bW[i] = bH[i] * (0.62 - 0.1 * si);
      if (si <= BODY_END) lastBody = i;
    }

    // 4) outlines of each slice (projected)
    var EX = new Float64Array(N * M), EY = new Float64Array(N * M);
    for (i = 0; i <= lastBody; i++) {
      for (k = 0; k < M; k++) {
        var ph = k / M * TAU, ca = Math.cos(ph) * bH[i], sa = Math.sin(ph) * bW[i];
        var x3 = Qx[i] + Ux[i] * ca + Lx[i] * sa, y3 = Qy[i] + Uy[i] * ca + Ly[i] * sa, z3 = Qz[i] + Uz[i] * ca + Lz[i] * sa;
        EX[i * M + k] = projX(x3, z3); EY[i * M + k] = projY(y3, z3);
      }
    }

    // 5) body segments
    for (i = 0; i < lastBody; i++) {
      if (bH[i] < 0.25 && bH[i + 1] < 0.25) continue;
      prims.push({ t: 0, i: i, z: (Qz[i] + Qz[i + 1]) / 2 });
    }

    // 6) fins
    var finPts = [];
    for (j = 0; j < FINS.length; j++) {
      var fin = FINS[j], sides = fin.pair ? [1, -1] : [1];
      for (var sd = 0; sd < sides.length; sd++) {
        var sg = sides[sd], prev = null;
        for (i = 0; i < N; i++) {
          var sN = i / (N - 1), h0 = bH[i], w0 = bW[i];
          var seg = fin.fn(sN, Hm, h0 || bH[lastBody], w0 || bW[lastBody]);
          var cur = null;
          if (seg) {
            var l0 = seg[0] * sg, v0 = seg[1], l1 = seg[2] * sg, v1 = seg[3];
            var ax3 = Qx[i] + Lx[i] * l0 + Ux[i] * v0, ay3 = Qy[i] + Ly[i] * l0 + Uy[i] * v0, az3 = Qz[i] + Lz[i] * l0 + Uz[i] * v0;
            var bx3 = Qx[i] + Lx[i] * l1 + Ux[i] * v1, by3 = Qy[i] + Ly[i] * l1 + Uy[i] * v1, bz3 = Qz[i] + Lz[i] * l1 + Uz[i] * v1;
            cur = [projX(ax3, az3), projY(ay3, az3), projX(bx3, bz3), projY(by3, bz3), (az3 + bz3) / 2];
          }
          if (prev && cur) {
            prims.push({ t: 1, q: [prev[0], prev[1], prev[2], prev[3], cur[2], cur[3], cur[0], cur[1]], color: fin.color, z: (prev[4] + cur[4]) / 2, i: i });
          }
          prev = cur;
        }
      }
    }

    // 7) eyes: small dark beads set on the front of the head so they show head-on too
    var ie = Math.max(1, Math.round(0.07 * (N - 1)));
    var Tx = this.T2[0], Ty = this.T2[1], Tz = this.T2[2];
    for (var es = -1; es <= 1; es += 2) {
      var ex3 = Qx[ie] + Ux[ie] * bH[ie] * 0.12 + Lx[ie] * es * bW[ie] * 0.84;
      var ey3 = Qy[ie] + Uy[ie] * bH[ie] * 0.12 + Ly[ie] * es * bW[ie] * 0.84;
      var ez3 = Qz[ie] + Uz[ie] * bH[ie] * 0.12 + Lz[ie] * es * bW[ie] * 0.84;
      var nx = Lx[ie] * es * 0.8 + Tx[ie] * 0.6, ny = Ly[ie] * es * 0.8 + Ty[ie] * 0.6, nz = Lz[ie] * es * 0.8 + Tz[ie] * 0.6;
      var facing = -nz / Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (facing > 0.04) prims.push({ t: 2, x: projX(ex3, ez3), y: projY(ey3, ez3), r: Math.max(0.8, 0.016 * L) * (F / (F + ez3)) * (0.8 + 0.2 * Math.min(1, facing * 2.5)), z: Qz[Math.max(0, ie - 2)] - 0.5 });
    }

    // 8) speckles: lots of tiny ones, jittered between slices; pale on the back, a few red low on the flank
    var i0 = Math.round(0.12 * (N - 1)), i1 = Math.round(0.80 * (N - 1));
    for (i = i0; i <= i1; i++) {
      for (k = 0; k < SPOT_ANGLES.length; k++) {
        var al = SPOT_ANGLES[k], red = Math.abs(al) >= 90;
        if (hash(i * 7.3 + k * 1.9) > (red ? 0.15 : 0.28)) continue;
        var o = hash(i * 5.1 + k * 3.7) - 0.5, i2 = o > 0 ? Math.min(N - 1, i + 1) : Math.max(0, i - 1), tt = Math.abs(o);
        var alr = (al + (hash(i * 2.3 + k * 6.1) - 0.5) * 10) * PI / 180, ca2 = Math.cos(alr), sa2 = Math.sin(alr);
        var Hh = lerp(bH[i], bH[i2], tt), Ww = lerp(bW[i], bW[i2], tt);
        var Qx_ = lerp(Qx[i], Qx[i2], tt), Qy_ = lerp(Qy[i], Qy[i2], tt), Qz_ = lerp(Qz[i], Qz[i2], tt);
        var uxs = lerp(Ux[i], Ux[i2], tt), uys = lerp(Uy[i], Uy[i2], tt), uzs = lerp(Uz[i], Uz[i2], tt);
        var lxs = lerp(Lx[i], Lx[i2], tt), lys = lerp(Ly[i], Ly[i2], tt), lzs = lerp(Lz[i], Lz[i2], tt);
        var px3 = Qx_ + uxs * Hh * ca2 + lxs * Ww * sa2;
        var py3 = Qy_ + uys * Hh * ca2 + lys * Ww * sa2;
        var pz3 = Qz_ + uzs * Hh * ca2 + lzs * Ww * sa2;
        var snz = uzs * ca2 / Math.max(Hh, 1e-3) + lzs * sa2 / Math.max(Ww, 1e-3);
        var snx = uxs * ca2 / Math.max(Hh, 1e-3) + lxs * sa2 / Math.max(Ww, 1e-3);
        var sny = uys * ca2 / Math.max(Hh, 1e-3) + lys * sa2 / Math.max(Ww, 1e-3);
        var snl = Math.sqrt(snx * snx + sny * sny + snz * snz) || 1;
        var fc = -snz / snl;
        if (fc < 0.1) continue;
        var rr = (0.0085 + 0.006 * hash(i * 3.1 + k)) * L * (F / (F + pz3)) * (0.5 + 0.5 * fc);
        prims.push({ t: 3, x: projX(px3, pz3), y: projY(py3, pz3), r: Math.max(0.6, rr), z: pz3 - 0.3, red: red });
      }
    }

    // 9) paint far -> near
    prims.sort(function (a, b) { return b.z - a.z; });

    var band = c.BAND;
    ctx.lineJoin = 'round';
    for (var pi = 0; pi < prims.length; pi++) {
      var p = prims[pi];
      if (p.t === 0) this._drawSegment(ctx, p.i, EX, EY, bH, bW, band);
      else if (p.t === 1) {
        var q = p.q, col = p.color;
        var fog = 1 - 0.3 * clamp(p.z / (L * 1.1), 0, 1);
        ctx.beginPath();
        ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]); ctx.lineTo(q[4], q[5]); ctx.lineTo(q[6], q[7]);
        ctx.closePath();
        ctx.fillStyle = rgba(col, fog, col[3]);
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(12,12,12,0.4)';
        ctx.stroke();
      } else if (p.t === 2) {
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.62, 0, 0, TAU);   // oval, wider than tall
        ctx.fillStyle = '#0b0b0b'; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fillStyle = p.red ? speckRed : speckPale; ctx.fill();
      }
    }
  };

  Trout.prototype._drawSegment = function (ctx, i, EX, EY, bH, bW, band) {
    var N = this.N, L = this.L, F = this.cfg.FOCAL * this.S, hx = this.hx, hy = this.hy, k;
    var a = i, b = i + 1;
    var pts = [];
    for (k = 0; k < M; k++) { pts.push([EX[a * M + k], EY[a * M + k]]); pts.push([EX[b * M + k], EY[b * M + k]]); }
    var hull = convexHull(pts);
    if (hull.length < 3) return;

    // mid-slice frame
    var Ux = this.U2, Lx = this.L2, Q = [this.qx, this.qy, this.qz];
    var mx = (Q[0][a] + Q[0][b]) / 2, my = (Q[1][a] + Q[1][b]) / 2, mz = (Q[2][a] + Q[2][b]) / 2;
    var ux = Ux[0][a] + Ux[0][b], uy = Ux[1][a] + Ux[1][b], uz = Ux[2][a] + Ux[2][b];
    var lx = Lx[0][a] + Lx[0][b], ly = Lx[1][a] + Lx[1][b], lz = Lx[2][a] + Lx[2][b];
    var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1, ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    ux /= ul; uy /= ul; uz /= ul; lx /= ll; ly /= ll; lz /= ll;
    var bm = (bH[a] + bH[b]) / 2, am = (bW[a] + bW[b]) / 2;

    // lighting from the surface that faces the camera
    var vx = -uz * ux - lz * lx, vy = -uz * uy - lz * ly, vz = -uz * uz - lz * lz;
    var vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (vl < 1e-3) { vx = ux; vy = uy; vz = uz; vl = 1; }
    var dif = Math.max(0, (vx * LIGHT[0] + vy * LIGHT[1] + vz * LIGHT[2]) / vl);
    var fog = 1 - 0.34 * clamp(mz / (L * 1.05), 0, 1);
    var br = (baseExp + 0.5 * dif) * fog;

    function proj(x, y, z) { var sc = F / (F + z); return [hx + (x - hx) * sc, hy + (y - hy) * sc]; }

    // vertical (dorsal->ventral) gradient, and a side-to-side one for when we look down on the back
    var mL = ss((-uz - 0.3) / 0.5);
    var pd = proj(mx + ux * bm, my + uy * bm, mz + uz * bm), pv = proj(mx - ux * bm, my - uy * bm, mz - uz * bm);
    var pl = proj(mx + lx * am, my + ly * am, mz + lz * am), pr = proj(mx - lx * am, my - ly * am, mz - lz * am);

    ctx.beginPath();
    ctx.moveTo(hull[0][0], hull[0][1]);
    for (k = 1; k < hull.length; k++) ctx.lineTo(hull[k][0], hull[k][1]);
    ctx.closePath();

    var gU;
    if (Math.abs(pd[0] - pv[0]) + Math.abs(pd[1] - pv[1]) > 1.5) {
      gU = ctx.createLinearGradient(pd[0], pd[1], pv[0], pv[1]);
      for (k = 0; k < lookV.length; k++) gU.addColorStop(lookV[k][0], rgb(lookV[k][1], br));
    } else gU = rgb(lookV[1][1], br);
    ctx.fillStyle = gU;
    ctx.fill();

    if (mL > 0.02 && Math.abs(pl[0] - pr[0]) + Math.abs(pl[1] - pr[1]) > 1.5) {
      var gL = ctx.createLinearGradient(pl[0], pl[1], pr[0], pr[1]);
      for (k = 0; k < lookL.length; k++) gL.addColorStop(lookL[k][0], rgb(lookL[k][1], br));
      ctx.globalAlpha = mL; ctx.fillStyle = gL; ctx.fill(); ctx.globalAlpha = 1;
    }

    if (band > 0 && (i % this.cfg.SLICE_STEP === 0)) {
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = 'rgba(0,0,0,' + band + ')';
      ctx.stroke();
    }
  };

  root.Trout = Trout;
  root.TROUT_CFG = CFG;
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================ PAGE WIRING ============================= */
/* Mounts the trout inside <div id="troutStage"> and keeps it in the page flow.
   The stage's own rectangle (minus INSET) is the activity box. */
(function () {
  'use strict';

  var INSET = 0;   // px between the stage edge and the activity box (room for the wall glow)
  var MOBILE_HOLD_MS = 1000;   // touch only: how long (ms) the trout stays on a tap before returning to center
  var SHOW_BOX_OUTLINE = false;   // true = draw a faint outline of the box, to see exactly where it is

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function init() {
    var stage = document.getElementById('troutStage');
    if (!stage || !window.Trout) return;

    var cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    stage.appendChild(cv);
    var ctx = cv.getContext('2d');
    var trout = new window.Trout(ctx);
    var cfg = trout.cfg;

    var dpr = 1, w = 0, h = 0;
    var target = { x: 0, y: 0 };
    var box = { x: 0, y: 0, w: 0, h: 0 };
    var center = { x: 0, y: 0 };
    var engaged = false, leaving = false, mobileUntil = 0, ready = false;
    var lastPointer = null;   // last pointer position in client coords
    var mobile = window.matchMedia('(hover: none) and (pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    function insideBox(x, y) {
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    }

    function clampTarget(x, y) {
      var pad = 4;   // px the snout stays from the wall; 0 = touches it exactly
      target.x = clamp(x, box.x + pad, box.x + box.w - pad);
      target.y = clamp(y, box.y + pad, box.y + box.h - pad);
    }

    function resize() {
      var nw = stage.clientWidth, nh = stage.clientHeight;
      if (!nw || !nh) return;
      w = nw; h = nh;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // the whole stage (link row included) is the box; the fish swims behind the links
      box.x = INSET; box.y = INSET;
      box.w = w - INSET * 2; box.h = Math.max(40, h - INSET * 2);
      center.x = box.x + box.w / 2;
      center.y = box.y + box.h / 2;

      trout.setViewport(w, h);
      trout.setLength(Math.min(cfg.LENGTH, w * 0.5));
      trout.setEaseScale(Math.min(box.w, box.h));

      if (!ready) { trout.reset(center.x, center.y); ready = true; }
      if (!engaged) { target.x = center.x; target.y = center.y; }
      else clampTarget(target.x, target.y);
    }

    function engageAt(x, y) { clampTarget(x, y); engaged = true; leaving = false; }

    // cursor left the box: aim for the edge point nearest the cursor, return to center only after arriving
    function beginLeave(x, y) {
      if (!engaged || leaving) return;
      clampTarget(x, y);
      leaving = true;
    }

    function disengage() {
      engaged = false; leaving = false; mobileUntil = 0;
      target.x = center.x; target.y = center.y;
    }

    // client coords -> stage coords (re-measured every time, since the page scrolls)
    function local(cx, cy) {
      var r = cv.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    }

    function updateFromPointer() {
      if (!lastPointer || !ready) return;
      var p = local(lastPointer.x, lastPointer.y);
      if (insideBox(p.x, p.y)) engageAt(p.x, p.y);
      else if (engaged) beginLeave(p.x, p.y);
    }

    function drawBoxGlow() {
      if (!box.w || !box.h) return;
      var x = trout.hx, y = trout.hy;
      var left = box.x, right = box.x + box.w, top = box.y, bottom = box.y + box.h;
      var dl = Math.abs(x - left), dr = Math.abs(right - x), dt = Math.abs(y - top), db = Math.abs(bottom - y);
      var nearest = Math.min(dl, dr, dt, db);
      if (nearest >= cfg.BOX_GLOW_RANGE) return;

      var intensity = 1 - nearest / cfg.BOX_GLOW_RANGE;
      intensity = intensity * intensity * (3 - 2 * intensity);

      var horizontal = nearest === dt || nearest === db;
      var half = cfg.BOX_GLOW_LENGTH * 0.5;
      var ax, ay, bx, by;
      if (horizontal) {
        var cx = clamp(x, left, right);
        ay = by = (nearest === dt) ? top : bottom;
        ax = Math.max(left, cx - half); bx = Math.min(right, cx + half);
      } else {
        var cy = clamp(y, top, bottom);
        ax = bx = (nearest === dl) ? left : right;
        ay = Math.max(top, cy - half); by = Math.min(bottom, cy + half);
      }

      ctx.save();
      ctx.lineCap = 'round';
      var gc = Math.round(255 + (20 - 255) * (window.siteTheme ? window.siteTheme.mix : 0));   // white at night, near-black in day
      var layers = [[7, 0.035], [3, 0.11], [1, 0.48]];
      for (var i = 0; i < layers.length; i++) {
        ctx.beginPath();
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.lineWidth = layers[i][0];
        ctx.strokeStyle = 'rgba(' + gc + ',' + gc + ',' + gc + ',' + (layers[i][1] * intensity) + ')';
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---- input (listeners on window: the canvas is pointer-events:none so it never blocks the page) ---- */
    window.addEventListener('pointermove', function (e) {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (mobile) return;
      updateFromPointer();
    });

    window.addEventListener('pointerdown', function (e) {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (!ready) return;
      var p = local(e.clientX, e.clientY);
      if (!insideBox(p.x, p.y)) return;
      engageAt(p.x, p.y);
      if (mobile) mobileUntil = performance.now() + MOBILE_HOLD_MS;
    });

    // the page moves under a stationary cursor, so re-check on scroll
    window.addEventListener('scroll', function () { if (!mobile) updateFromPointer(); }, { passive: true });

    document.addEventListener('mouseleave', function () {
      if (!mobile && engaged) beginLeave(target.x, target.y);
    });

    /* ---- sizing ---- */
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);
    resize();

    /* ---- lets sin-wave.js ask where the activity box is (viewport coords) ---- */
    window.getTroutBox = function () {
      if (!ready) return null;
      var r = cv.getBoundingClientRect();
      return { l: r.left + INSET, t: r.top + INSET, r: r.left + w - INSET, b: r.top + h - INSET };
    };

    /* ---- animation loop (only runs while the stage is on screen) ---- */
    var last = performance.now(), running = false;

    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;

      if (mobile && engaged && mobileUntil && now >= mobileUntil) disengage();

      if (leaving && Math.hypot(trout.hx - target.x, trout.hy - target.y) < 30) disengage();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (SHOW_BOX_OUTLINE) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
      }
      drawBoxGlow();
      trout.step(dt, target.x, target.y);
      trout.draw();

      requestAnimationFrame(frame);
    }

    function start() { if (running) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
    function stop() { running = false; }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) start(); else stop();
      }).observe(stage);
    } else start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
