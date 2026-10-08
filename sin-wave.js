/* Sine-wave background, standalone.
   Draws onto <canvas id="wave">. Load with <script src="sin-wave.js"></script>
   AFTER theme.js, your main script, and trout.js.
   Colors follow the day / night theme through window.siteTheme (see theme.js). */
(function () {
  var canvas = document.getElementById('wave');
  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var w, h, dpr;
  var running = true;
  var frameId = null;

  // ---- Theme colors (night -> day), refreshed once per frame by updateTheme() ----
  var BG_LINE_NIGHT = [28, 27, 27];      // #1c1b1b
  var BG_LINE_DAY = [238, 238, 238];     // #eaeaea, barely visible on the light page
  var bgLineColor = 'rgb(28,27,27)';
  var nameRed = 'rgb(255,77,77)';        // red wave lines inside the name
  var nameGlowRGB = '0,0,0';             // pulse glow inside the name: black at night, white in day

  // ---- Overlay canvas: wave lines clipped to the letters of the name ----
  var NAME_LINE_WIDTH = 1.5;
  var NAME_GLOW_WIDTH = 2.2;
  var NAME_GLOW_BOOST = 2;      // how quickly the glow turns solid
  var nameEl = document.querySelector('.hero h1, .name');
  var nameCanvas = document.createElement('canvas');
  nameCanvas.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2;';
  document.body.appendChild(nameCanvas);
  var nctx = nameCanvas.getContext('2d');

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nameCanvas.width = w * dpr;
    nameCanvas.height = h * dpr;
    nameCanvas.style.width = w + 'px';
    nameCanvas.style.height = h + 'px';
  }

  // ---- Background wave (10 lines, evenly spaced) ----
  var lines = [
    { y: 0.05, amp: 16, freq: 0.0022, speed: 0.0040, phase: 0.0, p: 0, intensity: 0 },
    { y: 0.15, amp: 24, freq: 0.0016, speed: 0.0028, phase: 1.4, p: 0, intensity: 0 },
    { y: 0.25, amp: 13, freq: 0.0028, speed: 0.0052, phase: 3.1, p: 0, intensity: 0 },
    { y: 0.35, amp: 21, freq: 0.0018, speed: 0.0036, phase: 4.6, p: 0, intensity: 0 },
    { y: 0.45, amp: 15, freq: 0.0024, speed: 0.0044, phase: 2.2, p: 0, intensity: 0 },
    { y: 0.55, amp: 18, freq: 0.0020, speed: 0.0032, phase: 5.5, p: 0, intensity: 0 },
    { y: 0.65, amp: 19, freq: 0.0021, speed: 0.0038, phase: 0.8, p: 0, intensity: 0 },
    { y: 0.75, amp: 14, freq: 0.0026, speed: 0.0046, phase: 3.9, p: 0, intensity: 0 },
    { y: 0.85, amp: 22, freq: 0.0017, speed: 0.0030, phase: 2.9, p: 0, intensity: 0 },
    { y: 0.95, amp: 17, freq: 0.0019, speed: 0.0034, phase: 1.9, p: 0, intensity: 0 }
  ];

  var WAVINESS = 3;  // 1 = original, higher = wavier
  var SAMPLE_STEP = 6;   // px between samples along each line

  function ss(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }

  // ---- Trout activity box: no cursor-driven waves inside it ----
  // trout.js exposes window.getTroutBox() -> { l, t, r, b } in viewport px (or null).
  // Hover bumps and click pulses fade to nothing over the last BOX_TAPER px before the
  // box and stay at zero inside it. The ambient hum is NOT masked.
  var BOX_TAPER = 40;     // px over which hover/click waves ease out before reaching the box
  var troutBox = null;    // refreshed every frame

  function updateTroutBox() {
    troutBox = (typeof window.getTroutBox === 'function') ? window.getTroutBox() : null;
  }

  // 0 inside the box, easing up to 1 once BOX_TAPER px away from it
  function boxMaskAt(x, y) {
    if (!troutBox) return 1;
    var dx = Math.max(troutBox.l - x, 0, x - troutBox.r);
    var dy = Math.max(troutBox.t - y, 0, y - troutBox.b);
    return ss(Math.sqrt(dx * dx + dy * dy) / BOX_TAPER);
  }

  function waveY(l, x) {
    return h * l.y
      + Math.sin(x * l.freq + l.p + l.phase) * l.amp * WAVINESS
      + Math.sin(x * l.freq * 2.3 - l.p * 0.6 + l.phase) * (l.amp * 0.3 * WAVINESS);
  }

  function advanceWave() {
    for (var i = 0; i < lines.length; i++) lines[i].p += lines[i].speed;
  }

  // wiggle offset for one line at x (hover bump + click pulses + ambient hum)
  function lineOffset(i, l, x) {
    var off = 0;
    var m = boxMaskAt(x, waveY(l, x));
    if (l.intensity > 0.001 && refPointActive) {
      var dx = x - refPointX;
      var gauss = Math.exp(-(dx * dx) / (2 * LOCAL_SIGMA * LOCAL_SIGMA));
      off += l.intensity * gauss * LOCAL_AMP * Math.sin(x * LOCAL_FREQ + wigglePhase);
    }
    off += pulseOffsetForLine(i, x);
    off *= m;                                   // cursor-driven part only
    off += ambientOffsetForLine(i, x);          // hum stays
    return off;
  }

  function drawWave() {
    ctx.strokeStyle = bgLineColor;
    ctx.lineWidth = 1;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      ctx.beginPath();
      for (var x = 0; x <= w; x += SAMPLE_STEP) {
        var y = waveY(l, x) + lineOffset(i, l, x);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    drawWiggleGlow();
  }

  // Glow gradient. Night: white-hot center that reddens as the wiggle tapers off.
  // Day: black center that goes to red the same way. Each frame, updateTheme() blends the two
  // sets of stops by the theme mix into glowStops, which glowColorForIntensity() reads.
  var GLOW_T = [0.00, 0.15, 0.35, 0.55, 0.75, 1.00];
  var GLOW_NIGHT = [
    [255, 255, 255],
    [255, 233, 229],
    [255, 176, 161],
    [255, 122, 105],
    [255, 77, 77],
    [196, 40, 34]
  ];
  var GLOW_DAY = [
    [0, 0, 0],
    [40, 3, 9],
    [93, 7, 21],
    [147, 12, 34],
    [200, 16, 46],     // the day crimson (same as theme.js)
    [150, 10, 30]
  ];
  var glowStops = [];
  var GLOW_ALPHA = 0.95;
  var GLOW_WIDTH = 1.8;
  var GLOW_THRESHOLD = 0.02;

  function updateTheme() {
    var st = window.siteTheme;

    var bg = st ? st.blend(BG_LINE_NIGHT, BG_LINE_DAY) : BG_LINE_NIGHT;
    bgLineColor = 'rgb(' + Math.round(bg[0]) + ',' + Math.round(bg[1]) + ',' + Math.round(bg[2]) + ')';

    glowStops.length = 0;
    for (var i = 0; i < GLOW_T.length; i++) {
      glowStops.push({ t: GLOW_T[i], c: st ? st.blend(GLOW_NIGHT[i], GLOW_DAY[i]) : GLOW_NIGHT[i] });
    }

    nameRed = 'rgb(' + (st ? st.redRGB() : '255,77,77') + ')';
    var g = Math.round(255 * (st ? st.mix : 0));
    nameGlowRGB = g + ',' + g + ',' + g;
  }

  function glowColorForIntensity(t) {
    var k = 1 - Math.min(1, Math.max(0, t));

    for (var i = 1; i < glowStops.length; i++) {
      if (k <= glowStops[i].t) {
        var a = glowStops[i - 1];
        var b = glowStops[i];
        var u = (k - a.t) / (b.t - a.t);
        var r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * u);
        var g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * u);
        var blue = Math.round(a.c[2] + (b.c[2] - a.c[2]) * u);
        return r + ',' + g + ',' + blue;
      }
    }

    var last = glowStops[glowStops.length - 1].c;
    return Math.round(last[0]) + ',' + Math.round(last[1]) + ',' + Math.round(last[2]);
  }

  function drawWiggleGlow() {
    if (!linePulses.length && !refPointActive && !ambientPulses.length) return;

    ctx.lineWidth = GLOW_WIDTH;

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];

      var hasPulse = false;
      for (var j = 0; j < linePulses.length; j++) {
        if (linePulses[j].lineIndex === i) { hasPulse = true; break; }
      }
      var hasAmbient = false;
      for (var m2 = 0; m2 < ambientPulses.length; m2++) {
        if (ambientPulses[m2].lineIndex === i) { hasAmbient = true; break; }
      }
      var hasHover = refPointActive && l.intensity > 0.001;
      if (!hasPulse && !hasHover && !hasAmbient) continue;

      var prevX = null, prevY = null, prevIntensity = 0;

      for (var x = 0; x <= w; x += 6) {
        var y0 = waveY(l, x), off = 0;
        var hoverIntensity = 0;
        var m = boxMaskAt(x, y0);

        if (hasHover) {
          var dx = x - refPointX;
          var gauss = Math.exp(-(dx * dx) / (2 * LOCAL_SIGMA * LOCAL_SIGMA));
          off += l.intensity * gauss * LOCAL_AMP * Math.sin(x * LOCAL_FREQ + wigglePhase);
          hoverIntensity = l.intensity * gauss * m;
        }
        off += pulseOffsetForLine(i, x);
        off *= m;
        off += ambientOffsetForLine(i, x);
        var y = y0 + off;

        var intensity = hoverIntensity;
        if (hasPulse) {
          var pulseIntensity = pulseIntensityForLine(i, x) * m;
          if (pulseIntensity > intensity) intensity = pulseIntensity;
        }
        if (hasAmbient) {
          var ambIntensity = ambientIntensityForLine(i, x);
          if (ambIntensity > intensity) intensity = ambIntensity;
        }

        if (prevX !== null && (intensity > GLOW_THRESHOLD || prevIntensity > GLOW_THRESHOLD)) {
          var segIntensity = Math.max(intensity, prevIntensity);
          ctx.strokeStyle = 'rgba(' + glowColorForIntensity(segIntensity) + ', ' + (segIntensity * GLOW_ALPHA).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }

        prevX = x; prevY = y; prevIntensity = intensity;
      }
    }

    ctx.lineWidth = 1;
  }

  // ---- Localized frequency bump (cursor / most-recently-opened toggle) ----
  var hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var PROXIMITY_MAX_DIST = 30;
  var LOCAL_SIGMA = 35;
  var LOCAL_FREQ = 0.5;
  var LOCAL_AMP = 25;

  var cursor = { x: 0, y: 0 };
  var lastMoveTime = 0;
  // shared with the main script so touch devices can follow open toggles
  var openStack = window.openStack || [];

  var refPointActive = false;
  var refPointX = 0;
  var refPointY = 0;
  var wigglePhase = 0;
  var REF_POINT_SMOOTHING = 0.15;

  if (hoverCapable) {
    window.addEventListener('mousemove', function (e) {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      lastMoveTime = performance.now();
    });
  }

  function updateProximity() {
    refPointActive = false;
    var targetX = refPointX, targetY = refPointY, hasTarget = false;

    if (hoverCapable) {
      if (lastMoveTime) {
        targetX = cursor.x;
        targetY = cursor.y;
        hasTarget = true;
      }
    } else if (openStack.length) {
      var btn = openStack[openStack.length - 1];
      var rect = btn.querySelector('.plus').getBoundingClientRect();
      targetX = rect.left + rect.width / 2;
      targetY = rect.top + rect.height / 2;
      hasTarget = true;
    }

    if (hasTarget) {
      refPointX += (targetX - refPointX) * REF_POINT_SMOOTHING;
      refPointY += (targetY - refPointY) * REF_POINT_SMOOTHING;
      refPointActive = true;
    }

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var target = 0;
      if (refPointActive) {
        var dist = Math.abs(waveY(l, refPointX) - refPointY);
        var proximity = 1 - Math.min(1, dist / PROXIMITY_MAX_DIST);
        target = Math.pow(Math.max(0, proximity), 3);
      }
      l.intensity += (target - l.intensity) * 0.2;
      if (l.intensity < 0.001) l.intensity = 0;
    }

    wigglePhase += 0.07;
  }

  // ---- Traveling line pulse (click exactly on a line) ----
  var LINE_CLICK_TOLERANCE = 9;
  var PULSE_DURATION = 60;

  var linePulses = [];

  function spawnLinePulse(lineIndex, originX) {
    linePulses.push({
      lineIndex: lineIndex,
      originX: originX,
      age: 0,
      leftDist: originX,
      rightDist: w - originX
    });
  }

  function updateLinePulses() {
    for (var i = linePulses.length - 1; i >= 0; i--) {
      var p = linePulses[i];
      p.age++;
      if (p.age >= PULSE_DURATION) {
        linePulses.splice(i, 1);
      }
    }
  }

  function pulseOffsetForLine(lineIndex, x) {
    var offset = 0;
    for (var i = 0; i < linePulses.length; i++) {
      var p = linePulses[i];
      if (p.lineIndex !== lineIndex) continue;

      var progress = Math.min(1, p.age / PULSE_DURATION);
      var amp = LOCAL_AMP * Math.max(0, 1 - progress);

      var rightFront = p.originX + p.rightDist * progress;
      var dxR = x - rightFront;
      offset += amp * Math.exp(-(dxR * dxR) / (2 * LOCAL_SIGMA * LOCAL_SIGMA))
                * Math.sin(dxR * LOCAL_FREQ + wigglePhase);

      var leftFront = p.originX - p.leftDist * progress;
      var dxL = x - leftFront;
      offset += amp * Math.exp(-(dxL * dxL) / (2 * LOCAL_SIGMA * LOCAL_SIGMA))
                * Math.sin(dxL * LOCAL_FREQ + wigglePhase);
    }
    return offset;
  }

  function pulseIntensityForLine(lineIndex, x) {
    var maxIntensity = 0;
    for (var i = 0; i < linePulses.length; i++) {
      var p = linePulses[i];
      if (p.lineIndex !== lineIndex) continue;

      var progress = Math.min(1, p.age / PULSE_DURATION);
      var fade = Math.max(0, 1 - progress);

      var rightFront = p.originX + p.rightDist * progress;
      var dxR = x - rightFront;
      var gR = Math.exp(-(dxR * dxR) / (2 * LOCAL_SIGMA * LOCAL_SIGMA));
      if (gR * fade > maxIntensity) maxIntensity = gR * fade;

      var leftFront = p.originX - p.leftDist * progress;
      var dxL = x - leftFront;
      var gL = Math.exp(-(dxL * dxL) / (2 * LOCAL_SIGMA * LOCAL_SIGMA));
      if (gL * fade > maxIntensity) maxIntensity = gL * fade;
    }
    return Math.min(1, maxIntensity);
  }

  // ---- Ambient hum (background lines only) ----
  // ACTIVE: every few seconds a soft pulse spawns on a random background line
  // (scheduleNextAmbientPulse() is called at the bottom of the file). It is skipped
  // when the visitor prefers reduced motion, and the trout box does not mask it.
  var ambientPulses = [];
  var AMBIENT_MIN_INTERVAL = 4000;
  var AMBIENT_MAX_INTERVAL = 8000;
  var AMBIENT_MAX_CONCURRENT = 4;
  var AMBIENT_DURATION = 300;
  var AMBIENT_SIGMA_MIN = 45;
  var AMBIENT_SIGMA_MAX = 95;
  var AMBIENT_PEAK_MIN = 0.28;
  var AMBIENT_PEAK_MAX = 0.35;

  function ambientEnvelope(p) {
    var t = Math.min(1, p.age / p.duration);
    return 0.5 * (1 - Math.cos(2 * Math.PI * t));
  }

  function spawnAmbientPulse() {
    if (!running || reduceMotion) return;
    if (ambientPulses.length >= AMBIENT_MAX_CONCURRENT) return;

    var li = Math.floor(Math.random() * lines.length);
    var ax = Math.random() * w;
    ambientPulses.push({
      lineIndex: li,
      x: ax,
      age: 0,
      duration: Math.round(AMBIENT_DURATION * (0.75 + Math.random() * 0.5)),
      sigma: AMBIENT_SIGMA_MIN + Math.random() * (AMBIENT_SIGMA_MAX - AMBIENT_SIGMA_MIN),
      peak: AMBIENT_PEAK_MIN + Math.random() * (AMBIENT_PEAK_MAX - AMBIENT_PEAK_MIN)
    });
  }

  function scheduleNextAmbientPulse() {
    var delay = AMBIENT_MIN_INTERVAL + Math.random() * (AMBIENT_MAX_INTERVAL - AMBIENT_MIN_INTERVAL);
    setTimeout(function () {
      spawnAmbientPulse();
      scheduleNextAmbientPulse();
    }, delay);
  }

  function updateAmbientPulses() {
    for (var i = ambientPulses.length - 1; i >= 0; i--) {
      var p = ambientPulses[i];
      p.age++;
      if (p.age >= p.duration) ambientPulses.splice(i, 1);
    }
  }

  function ambientOffsetForLine(lineIndex, x) {
    var offset = 0;
    for (var i = 0; i < ambientPulses.length; i++) {
      var p = ambientPulses[i];
      if (p.lineIndex !== lineIndex) continue;

      var dx = x - p.x;
      var gauss = Math.exp(-(dx * dx) / (2 * p.sigma * p.sigma));
      var env = ambientEnvelope(p) * p.peak;
      offset += env * gauss * LOCAL_AMP * Math.sin(x * LOCAL_FREQ + wigglePhase);
    }
    return offset;
  }

  function ambientIntensityForLine(lineIndex, x) {
    var maxIntensity = 0;
    for (var i = 0; i < ambientPulses.length; i++) {
      var p = ambientPulses[i];
      if (p.lineIndex !== lineIndex) continue;

      var dx = x - p.x;
      var gauss = Math.exp(-(dx * dx) / (2 * p.sigma * p.sigma));
      var val = ambientEnvelope(p) * p.peak * gauss;
      if (val > maxIntensity) maxIntensity = val;
    }
    return Math.min(1, maxIntensity);
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('a')) return;
    if (e.target.closest('.entry-toggle')) return;
    if (e.target.closest('.photo-thumb')) return;
    if (e.target.closest('.lightbox')) return;

    // clicks inside the trout box never spawn a pulse
    updateTroutBox();
    if (troutBox && e.clientX >= troutBox.l && e.clientX <= troutBox.r &&
        e.clientY >= troutBox.t && e.clientY <= troutBox.b) return;

    var bestIdx = -1, bestDiff = Infinity;
    for (var i = 0; i < lines.length; i++) {
      var diff = Math.abs(waveY(lines[i], e.clientX) - e.clientY);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    if (bestIdx !== -1 && bestDiff <= LINE_CLICK_TOLERANCE) {
      spawnLinePulse(bestIdx, e.clientX);
    }
  });

  var sampleY = 0, sampleI = 0;

  // Same line math as drawWave/drawWiggleGlow: gives y and glow intensity at x
  function sampleLine(i, x) {
    var l = lines[i];
    var y0 = waveY(l, x), off = 0, inten = 0;
    var m = boxMaskAt(x, y0);
    if (l.intensity > 0.001 && refPointActive) {
      var dx = x - refPointX;
      var g = Math.exp(-(dx * dx) / (2 * LOCAL_SIGMA * LOCAL_SIGMA));
      off += l.intensity * g * LOCAL_AMP * Math.sin(x * LOCAL_FREQ + wigglePhase);
      inten = l.intensity * g * m;
    }
    off += pulseOffsetForLine(i, x);
    off *= m;
    off += ambientOffsetForLine(i, x);
    var pI = pulseIntensityForLine(i, x) * m;
    if (pI > inten) inten = pI;
    var aI = ambientIntensityForLine(i, x);
    if (aI > inten) inten = aI;
    sampleY = y0 + off;
    sampleI = Math.min(1, inten);
  }

  function drawNameLines() {
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nctx.globalCompositeOperation = 'source-over';
    nctx.clearRect(0, 0, w, h);
    if (!nameEl || !nameEl.firstChild) return;

    var range = document.createRange();
    range.selectNodeContents(nameEl);
    var r = range.getBoundingClientRect();
    if (r.bottom < 0 || r.top > h || r.width === 0) return;

    var cs = getComputedStyle(nameEl);
    nctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    nctx.textAlign = 'left';
    nctx.textBaseline = 'alphabetic';
    var text = nameEl.textContent.trim();
    var m = nctx.measureText(text);
    var baseY = r.top + (m.fontBoundingBoxAscent || r.height * 0.8);

    var x0 = Math.max(0, Math.floor(r.left) - 10);
    var x1 = Math.min(w, Math.ceil(r.right) + 10);
    var cy = (r.top + r.bottom) / 2;
    var STEP = 2;

    nctx.lineCap = 'round';
    nctx.lineJoin = 'round';

    for (var i = 0; i < lines.length; i++) {
      if (Math.abs(waveY(lines[i], (x0 + x1) / 2) - cy) > r.height / 2 + 160) continue;

      var xs = [], ys = [], ins = [];
      for (var x = x0; x <= x1; x += STEP) {
        sampleLine(i, x);
        xs.push(x); ys.push(sampleY); ins.push(sampleI);
      }

      // base line: red
      nctx.strokeStyle = nameRed;
      nctx.lineWidth = NAME_LINE_WIDTH;
      nctx.beginPath();
      for (var k = 0; k < xs.length; k++) {
        if (k === 0) nctx.moveTo(xs[k], ys[k]); else nctx.lineTo(xs[k], ys[k]);
      }
      nctx.stroke();

      // pulse / hover / ambient glow: black at night, white in day
      nctx.lineWidth = NAME_GLOW_WIDTH;
      for (var j = 1; j < xs.length; j++) {
        var s = Math.max(ins[j], ins[j - 1]);
        if (s <= GLOW_THRESHOLD) continue;
        nctx.strokeStyle = 'rgba(' + nameGlowRGB + ',' + Math.min(1, s * NAME_GLOW_BOOST).toFixed(3) + ')';
        nctx.beginPath();
        nctx.moveTo(xs[j - 1], ys[j - 1]);
        nctx.lineTo(xs[j], ys[j]);
        nctx.stroke();
      }
    }

    // keep only what's inside the letters
    nctx.globalCompositeOperation = 'destination-in';
    nctx.fillStyle = '#000';
    nctx.fillText(text, r.left, baseY);
    nctx.globalCompositeOperation = 'source-over';
  }

  function draw() {
    updateTheme();
    updateTroutBox();
    ctx.clearRect(0, 0, w, h);
    drawWave();
    drawNameLines();
  }

  function loop() {
    if (!running) { frameId = null; return; }
    advanceWave();
    updateProximity();
    updateLinePulses();
    updateAmbientPulses();
    draw();
    frameId = requestAnimationFrame(loop);
  }

  window.addEventListener('resize', function () {
    resize();
    if (reduceMotion) draw();
  });
  if (reduceMotion) {
    window.addEventListener('scroll', draw, { passive: true });
    // no animation loop in this mode, so redraw on every step of the day/night fade
    window.addEventListener('themechange', draw);
  }

  document.addEventListener('visibilitychange', function () {
    running = document.visibilityState === 'visible' && !reduceMotion;
    if (running && frameId === null) frameId = requestAnimationFrame(loop);
  });

  function relayoutAll() { if (reduceMotion) draw(); }
  window.addEventListener('load', relayoutAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayoutAll);

  resize();
  if (reduceMotion) {
    draw();
  } else {
    frameId = requestAnimationFrame(loop);
    scheduleNextAmbientPulse();
  }
})();