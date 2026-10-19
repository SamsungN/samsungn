/* theme.js — site-wide day / night theme AND the single home of every color on the site.
   Load in the <head> of every page, as the first script:
     <script src="theme.js"></script>

   ====================================================================
   WANT TO CHANGE THE LOOK? EDIT THE "PALETTE" BLOCK BELOW. NOTHING ELSE.
   ====================================================================
   - accent  is the MAIN color. The gradient lines, vertical rails, hover glow, wave glow ramp,
             name lines and the trout's side stripe all derive from it.
   - ink     is the text color. The end of every gradient follows it (light at night, dark in day).
   - Everything else (lines, tints, hover shade, surfaces, wave-line grey) is computed from
     bg / ink / accent using the small TUNING numbers further down.

   What else this file does
   - Estimates whether the sun is up for the visitor (from their timezone, no location prompt)
     and sets <html data-theme="day"> or "night" before the page paints.
   - Flips live, with a smooth fade, when the sun rises or sets while the page is open.
   - Clicking the name in the index hero (.hero h1) flips the theme by hand. The override lasts
     until the next real sunrise/sunset, or until the page reloads.
   - Shares the animated theme with the canvases (sin-wave.js, trout.js):
       window.siteTheme.mix             0 = night ... 1 = day (animated)
       window.siteTheme.isDay()         true if the target theme is day
       window.siteTheme.blend(n, d)     blends a number (or equal-length array) from night to day
       window.siteTheme.color(key)      current [r,g,b] of a palette key ('bg','ink','inkSoft','accent','onAccent')
       window.siteTheme.rgb(key)        the same, as a "r,g,b" string for rgba(...) use
       window.siteTheme.accent()        current accent as [r,g,b]
       window.siteTheme.accentRGB()     current accent as a "r,g,b" string
       window.siteTheme.waveLine()      [r,g,b] of the faint background wave lines
       window.siteTheme.glowStops()     [{t, c:[r,g,b]}...] ramp used by the wave glow
       window 'themechange' event       fires on every step of the fade
*/
(function () {
  'use strict';

  /* ==================================================================
     PALETTE — the only place colors are chosen
     ================================================================== */
  var PALETTE = {
    night: {
      bg:       '#141414',   // page background
      ink:      '#f2f2f2',   // main text (and the far end of every gradient)
      inkSoft:  '#9a9a96',   // secondary text
      accent:   '#4da3ff',   // MAIN COLOR, night: lighter blue for contrast on dark
      onAccent: '#000000'    // glow drawn on top of accent-colored text (the name)
    },
    day: {
      bg:       '#f7f7f7',
      ink:      '#050505',
      inkSoft:  '#3a3a37',
      accent:   '#0a4fa3',   // MAIN COLOR, day: strong marine blue (about 7:1 on the day bg)
      onAccent: '#ffffff'
    }
  };

  var SELECTION_BG = '#7fb8ff';   // text-selection highlight, both themes (text on it is always black)

  /* ------------------------------------------------------------------
     TUNING — how derived colors are computed (no colors here, just amounts)
     ------------------------------------------------------------------ */
  var TUNING = {
    LINE_ALPHA_NIGHT: 0.16,   // dividers / borders: ink at this opacity
    LINE_ALPHA_DAY: 0.24,
    TINT_ALPHA: 0.15,         // accent wash behind active toggle buttons
    HOVER_ALPHA: 0.045,       // ink wash behind a hovered section
    SURFACE_MIX: 0.06,        // surfaces (pdf frame): bg moved this far toward ink
    WAVE_LINE_MIX: 0.04,      // faint background wave lines: bg moved this far toward ink
    GLOW_END_DARKEN: 0.25,    // darkest end of the wave glow ramp: accent darkened by this much
    FADE_STOP: 0.42           // where the accent rail/underline fades out (0..1)
  };

  var GLOW_T = [0.00, 0.15, 0.35, 0.55, 0.75, 1.00];   // wave glow ramp positions (ink -> accent -> darker accent)

  var TRANSITION_MS = 900;   // length of the night <-> day fade
  var LAT_GUESS = 40;        // assumed latitude (deg). Only affects sunrise/sunset times; longitude comes from the timezone
  var CHECK_MS = 30000;      // how often to re-check the sun while the page is open

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     COLOR HELPERS
     ------------------------------------------------------------------ */
  function hexToRGB(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mixRGB(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function str(c) { return Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]); }
  function rgb(c) { return 'rgb(' + str(c) + ')'; }
  function rgba(c, a) { return 'rgba(' + str(c) + ',' + a + ')'; }

  var P = { night: {}, day: {} };
  ['night', 'day'].forEach(function (name) {
    for (var k in PALETTE[name]) P[name][k] = hexToRGB(PALETTE[name][k]);
  });

  /* ------------------------------------------------------------------
     SUN ESTIMATE
     Longitude is guessed from the timezone's standard-time offset, the hemisphere from
     whether daylight saving falls in January, and the latitude from LAT_GUESS. Then the
     standard solar-position formulas say whether the sun is above the horizon right now.
     Good to within a few minutes in most of the world.
     ------------------------------------------------------------------ */
  function estimateIsDay(date) {
    var yr = date.getFullYear();
    var jan = new Date(yr, 0, 1).getTimezoneOffset();
    var jul = new Date(yr, 6, 1).getTimezoneOffset();
    var stdOffset = Math.max(jan, jul);              // minutes behind UTC, in standard time
    var lon = -stdOffset / 4;                        // degrees east
    var lat = (jan < jul ? -LAT_GUESS : LAT_GUESS) * Math.PI / 180;   // DST in January = southern hemisphere

    var utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    var start = Date.UTC(date.getUTCFullYear(), 0, 0);
    var dayOfYear = Math.floor((date.getTime() - start) / 86400000);
    var g = 2 * Math.PI / 365 * (dayOfYear - 1 + (utcMin / 60 - 12) / 24);

    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
             - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
             - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
               - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));

    var solarMin = utcMin + eqTime + 4 * lon;        // true solar time, minutes
    var hourAngle = (solarMin / 4 - 180) * Math.PI / 180;
    var sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);

    return sinAlt > Math.sin(-0.833 * Math.PI / 180);   // sun's upper edge at the horizon, with refraction
  }

  /* ------------------------------------------------------------------
     CSS VARIABLES (generated from the palette)
     Every color the pages use is one of these variables:
       --bg --ink --ink-soft --accent --accent-tint --line --surface --hover-tint
       --flame / --flame-vertical          accent -> ink gradient (section dividers, pop-out lines)
       --accent-fade / --accent-fade-vertical   solid accent that fades out (rails)
     ------------------------------------------------------------------ */
  function varsFor(name) {
    var p = P[name];
    var lineA = name === 'day' ? TUNING.LINE_ALPHA_DAY : TUNING.LINE_ALPHA_NIGHT;
    return [
      '--bg:' + rgb(p.bg),
      '--ink:' + rgb(p.ink),
      '--ink-soft:' + rgb(p.inkSoft),
      '--accent:' + rgb(p.accent),
      '--accent-tint:' + rgba(p.accent, TUNING.TINT_ALPHA),
      '--line:' + rgba(p.ink, lineA),
      '--surface:' + rgb(mixRGB(p.bg, p.ink, TUNING.SURFACE_MIX)),
      '--hover-tint:' + rgba(p.ink, TUNING.HOVER_ALPHA)
    ].join(';');
  }

  var fadePct = Math.round(TUNING.FADE_STOP * 100) + '%';
  var GRADIENTS = [
    '--flame: linear-gradient(to right, var(--accent) 0%, var(--ink) 95%, transparent 100%)',
    '--flame-vertical: linear-gradient(to bottom, var(--accent) 0%, var(--ink) 95%, transparent 100%)',
    '--accent-fade: linear-gradient(to right, var(--accent) 0%, var(--accent) ' + fadePct + ', transparent 100%)',
    '--accent-fade-vertical: linear-gradient(to bottom, var(--accent) 0%, var(--accent) ' + fadePct + ', transparent 100%)'
  ].join(';');

  var T = TRANSITION_MS + 'ms ease-in-out';
  var ANIMATED = ['bg', 'ink', 'ink-soft', 'line', 'accent', 'accent-tint', 'surface', 'hover-tint'];

  var css = [];

  // register the colors so the browser can fade them
  ANIMATED.forEach(function (v) {
    css.push('@property --' + v + ' { syntax: "<color>"; inherits: true; initial-value: #000; }');
  });

  css.push(':root, :root[data-theme="night"] { ' + varsFor('night') + '; ' + GRADIENTS + '; }');
  css.push(':root[data-theme="day"] { ' + varsFor('day') + '; ' + GRADIENTS + '; }');

  // the fade is only switched on while a flip is happening
  css.push(':root.theme-anim { transition: ' + ANIMATED.map(function (v) { return '--' + v + ' ' + T; }).join(', ') + '; }');
  css.push('@media (prefers-reduced-motion: reduce) { :root.theme-anim { transition: none; } }');

  // text selection: highlight color, black text, day and night
  css.push('::selection { background: ' + SELECTION_BG + '; color: #000; }');
  css.push('::-moz-selection { background: ' + SELECTION_BG + '; color: #000; }');

  // the name is the hidden toggle: no tap flash on phones
  css.push('.hero h1 { -webkit-tap-highlight-color: transparent; }');

  var styleEl = document.createElement('style');
  styleEl.setAttribute('data-theme-styles', '');
  styleEl.textContent = css.join('\n');
  (document.head || document.documentElement).appendChild(styleEl);

  /* ------------------------------------------------------------------
     STATE + FADE
     ------------------------------------------------------------------ */
  var root = document.documentElement;
  var autoDay = estimateIsDay(new Date());   // what the sun says
  var override = null;                       // null, or a manual choice (true = day)
  var targetDay = autoDay;                   // what is showing (or fading to)
  var raf = 0, animTimer = 0;

  var api = window.siteTheme = {
    mix: autoDay ? 1 : 0,
    isDay: function () { return targetDay; },
    blend: function (night, day) {
      var m = api.mix;
      if (typeof night === 'number') return night + (day - night) * m;
      var out = new Array(night.length);
      for (var i = 0; i < night.length; i++) out[i] = night[i] + (day[i] - night[i]) * m;
      return out;
    },
    color: function (key) { return api.blend(P.night[key], P.day[key]); },
    rgb: function (key) { return str(api.color(key)); },
    accent: function () { return api.color('accent'); },
    accentRGB: function () { return str(api.color('accent')); },
    waveLine: function () { return mixRGB(api.color('bg'), api.color('ink'), TUNING.WAVE_LINE_MIX); },
    glowStops: function () {
      var ink = api.color('ink'), acc = api.accent(), out = [];
      for (var i = 0; i < GLOW_T.length; i++) {
        var t = GLOW_T[i];
        var c = t <= 0.75 ? mixRGB(ink, acc, t / 0.75) : mixRGB(acc, [0, 0, 0], TUNING.GLOW_END_DARKEN * (t - 0.75) / 0.25);
        out.push({ t: t, c: c });
      }
      return out;
    }
  };

  function publish() {
    window.dispatchEvent(new CustomEvent('themechange'));
  }

  function setTheme(day, animate) {
    targetDay = day;
    var goal = day ? 1 : 0;
    cancelAnimationFrame(raf);
    clearTimeout(animTimer);

    if (!animate || reduceMotion) {
      root.classList.remove('theme-anim');
      root.setAttribute('data-theme', day ? 'day' : 'night');
      api.mix = goal;
      publish();
      return;
    }

    root.classList.add('theme-anim');
    root.setAttribute('data-theme', day ? 'day' : 'night');

    var from = api.mix, t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      var t = Math.min(1, (now - t0) / TRANSITION_MS);
      var e = t * t * (3 - 2 * t);
      api.mix = from + (goal - from) * e;
      publish();
      if (t < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    animTimer = setTimeout(function () { root.classList.remove('theme-anim'); }, TRANSITION_MS + 60);
  }

  // first paint: no fade
  setTheme(autoDay, false);

  /* ------------------------------------------------------------------
     LIVE CHECK: flip at the real sunrise / sunset while the page is open.
     A manual override is dropped the moment the sun next changes the theme.
     ------------------------------------------------------------------ */
  function check() {
    var nowDay = estimateIsDay(new Date());
    if (nowDay === autoDay) return;
    autoDay = nowDay;
    override = null;
    if (targetDay !== autoDay) setTheme(autoDay, true);
  }

  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') check();   // background tabs throttle timers
  });

  /* ------------------------------------------------------------------
     HIDDEN TOGGLE: click the name in the index hero
     ------------------------------------------------------------------ */
  function wireToggle() {
    var el = document.querySelector('.hero h1');
    if (!el) return;   // only the front page has one

    // a quick double-click would otherwise select the name
    el.addEventListener('mousedown', function (e) { if (e.detail > 1) e.preventDefault(); });

    el.addEventListener('click', function (e) {
      e.stopPropagation();   // keeps sin-wave.js from spawning a pulse for this click
      override = !targetDay;
      setTheme(override, true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireToggle);
  else wireToggle();
})();
