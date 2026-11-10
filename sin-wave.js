/* Sine-wave background, standalone.
   Draws onto <canvas id="wave">. Load with <script src="sin-wave.js"></script>
   AFTER theme.js, your main script, and trout.js.
   Every color here comes from theme.js through window.siteTheme; to change one, edit the
   PALETTE in theme.js, not this file.
   The lines just drift slowly. There is no hover, click, pulse, hum or glow behavior. */
(function () {
  var canvas = document.getElementById('wave');
  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var w, h, dpr;
  var running = true;
  var frameId = null;

  // ---- Theme colors, refreshed once per frame by updateTheme() ----
  var bgLineColor = '';     // faint background wave lines
  var nameAccent = '';      // accent wave lines inside the name

  // ---- Overlay canvas: wave lines clipped to the letters of the name ----
  var NAME_LINE_WIDTH = 1.5;
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
    { y: 0.05, amp: 16, freq: 0.0022, speed: 0.0040, phase: 0.0, p: 0 },
    { y: 0.15, amp: 24, freq: 0.0016, speed: 0.0028, phase: 1.4, p: 0 },
    { y: 0.25, amp: 13, freq: 0.0028, speed: 0.0052, phase: 3.1, p: 0 },
    { y: 0.35, amp: 21, freq: 0.0018, speed: 0.0036, phase: 4.6, p: 0 },
    { y: 0.45, amp: 15, freq: 0.0024, speed: 0.0044, phase: 2.2, p: 0 },
    { y: 0.55, amp: 18, freq: 0.0020, speed: 0.0032, phase: 5.5, p: 0 },
    { y: 0.65, amp: 19, freq: 0.0021, speed: 0.0038, phase: 0.8, p: 0 },
    { y: 0.75, amp: 14, freq: 0.0026, speed: 0.0046, phase: 3.9, p: 0 },
    { y: 0.85, amp: 22, freq: 0.0017, speed: 0.0030, phase: 2.9, p: 0 },
    { y: 0.95, amp: 17, freq: 0.0019, speed: 0.0034, phase: 1.9, p: 0 }
  ];

  var WAVINESS = 3;  // 1 = original, higher = wavier
  var SAMPLE_STEP = 6;   // px between samples along each line

  function waveY(l, x) {
    return h * l.y
      + Math.sin(x * l.freq + l.p + l.phase) * l.amp * WAVINESS
      + Math.sin(x * l.freq * 2.3 - l.p * 0.6 + l.phase) * (l.amp * 0.3 * WAVINESS);
  }

  function advanceWave() {
    for (var i = 0; i < lines.length; i++) lines[i].p += lines[i].speed;
  }

  function updateTheme() {
    var st = window.siteTheme;
    var bg = st.waveLine();
    bgLineColor = 'rgb(' + Math.round(bg[0]) + ',' + Math.round(bg[1]) + ',' + Math.round(bg[2]) + ')';
    nameAccent = 'rgb(' + st.accentRGB() + ')';
  }

  function drawWave() {
    ctx.strokeStyle = bgLineColor;
    ctx.lineWidth = 1;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      ctx.beginPath();
      for (var x = 0; x <= w; x += SAMPLE_STEP) {
        var y = waveY(l, x);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
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
    nctx.strokeStyle = nameAccent;
    nctx.lineWidth = NAME_LINE_WIDTH;

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (Math.abs(waveY(l, (x0 + x1) / 2) - cy) > r.height / 2 + 160) continue;

      nctx.beginPath();
      for (var x = x0; x <= x1; x += STEP) {
        var y = waveY(l, x);
        if (x === x0) nctx.moveTo(x, y); else nctx.lineTo(x, y);
      }
      nctx.stroke();
    }

    // keep only what's inside the letters
    nctx.globalCompositeOperation = 'destination-in';
    nctx.fillStyle = '#000';   // mask only: this color is never visible
    nctx.fillText(text, r.left, baseY);
    nctx.globalCompositeOperation = 'source-over';
  }

  function draw() {
    updateTheme();
    ctx.clearRect(0, 0, w, h);
    drawWave();
    drawNameLines();
  }

  function loop() {
    if (!running) { frameId = null; return; }
    advanceWave();
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
  }
})();
