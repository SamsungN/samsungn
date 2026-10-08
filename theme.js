/* theme.js — site-wide day / night theme.
   Load in the <head> of every page, as the first script:
     <script src="theme.js"></script>

   What it does
   - Estimates whether the sun is up for the visitor (from their timezone, no location prompt)
     and sets <html data-theme="day"> or "night" before the page paints.
   - Flips live, with a smooth fade, when the sun rises or sets while the page is open.
   - Clicking the name in the index hero (.hero h1) flips the theme by hand. The override lasts
     until the next real sunrise/sunset, or until the page reloads.
   - Injects the day palette (including a deeper crimson red for day) and the red
     text-selection color.
   - Shares the animated theme with the canvases:
       window.siteTheme.mix          0 = night ... 1 = day (animated)
       window.siteTheme.isDay()      true if the target theme is day
       window.siteTheme.blend(n, d)  blends a number (or an equal-length array) from night to day
       window.siteTheme.red()        the current accent red as [r, g, b], blended night -> day
       window.siteTheme.redRGB()     the same, as a rounded "r,g,b" string for rgba(...) use
       window 'themechange' event    fires on every step of the fade
*/
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     TUNING
     ------------------------------------------------------------------ */
  var TRANSITION_MS = 900;   // length of the night <-> day fade
  var LAT_GUESS = 40;        // assumed latitude (deg). Only affects sunrise/sunset times; longitude comes from the timezone
  var CHECK_MS = 30000;      // how often to re-check the sun while the page is open
  var SELECT_BG = '#ff7a7a'; // text-selection highlight (text on it is always black)

  var NIGHT_RED = [255, 77, 77];   // #ff4d4d, the original accent
  var DAY_RED = [200, 16, 46];     // #c8102e, crimson; about 5.2:1 on the day background

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
     STYLES (palette, selection color, fade)
     The page colors are CSS variables. Registering them with @property lets the browser
     animate them smoothly, so every element that uses them fades together.
     ------------------------------------------------------------------ */
  var T = TRANSITION_MS + 'ms ease-in-out';

  var css = [
    '@property --bg { syntax: "<color>"; inherits: true; initial-value: #141414; }',
    '@property --ink { syntax: "<color>"; inherits: true; initial-value: #f2f2f2; }',
    '@property --ink-soft { syntax: "<color>"; inherits: true; initial-value: #9a9a96; }',
    '@property --line { syntax: "<color>"; inherits: true; initial-value: rgba(242,242,242,0.16); }',
    '@property --accent { syntax: "<color>"; inherits: true; initial-value: #ff4d4d; }',
    '@property --accent-tint { syntax: "<color>"; inherits: true; initial-value: rgba(255,77,77,0.16); }',
    '@property --cool { syntax: "<color>"; inherits: true; initial-value: #ff4d4d; }',
    '@property --cool-tint { syntax: "<color>"; inherits: true; initial-value: rgba(255,77,77,0.14); }',

    /* the fade is only switched on while a flip is happening */
    ':root.theme-anim { transition: --bg ' + T + ', --ink ' + T + ', --ink-soft ' + T + ', --line ' + T + ', ' +
      '--accent ' + T + ', --accent-tint ' + T + ', --cool ' + T + ', --cool-tint ' + T + '; }',
    '@media (prefers-reduced-motion: reduce) { :root.theme-anim { transition: none; } }',

    /* day = the two main values swapped; the grey is darkened so it stays readable on light;
       the red deepens to crimson so it holds up against the light background */
    ':root[data-theme="day"] { --bg: #f7f7f7; --ink: #050505; --ink-soft: #3a3a37; --line: rgba(5,5,5,0.24); ' +
      '--accent: rgb(' + DAY_RED.join(',') + '); --accent-tint: rgba(' + DAY_RED.join(',') + ',0.14); ' +
      '--cool: rgb(' + DAY_RED.join(',') + '); --cool-tint: rgba(' + DAY_RED.join(',') + ',0.12); }',

    /* gradients that hardcode the night red: in day they follow the animated accent instead.
       (Gradients can't fade on their own, so these swap at the flip; the colors around them fade.) */
    ':root[data-theme="day"] { ' +
      '--cool-flame: linear-gradient(to right, var(--accent) 0%, var(--accent) 42%, transparent 100%); ' +
      '--cool-flame-vertical: linear-gradient(to bottom, var(--accent) 0%, var(--accent) 42%, transparent 100%); ' +
      '--flame: linear-gradient(to right, var(--accent) 0%, var(--accent) 30%, transparent 100%); ' +
      '--flame-vertical: linear-gradient(to bottom, var(--accent) 0%, var(--accent) 30%, transparent 100%); }',

    /* hardcoded light-on-dark tints that need a dark-on-light twin */
    '@media (hover: hover) and (pointer: fine) { :root[data-theme="day"] .toggle-section:hover { background: rgba(20,20,20,0.05); } }',
    ':root[data-theme="day"] .resume-section:hover { background: rgba(20,20,20,0.05); }',
    ':root[data-theme="day"] .pdf-frame { background: #e6e8ea; }',

    /* red highlight, black text, day and night */
    '::selection { background: ' + SELECT_BG + '; color: #000; }',
    '::-moz-selection { background: ' + SELECT_BG + '; color: #000; }',

    /* the name is the hidden toggle: no tap flash on phones */
    '.hero h1 { -webkit-tap-highlight-color: transparent; }'
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.setAttribute('data-theme-styles', '');
  styleEl.textContent = css;
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
    red: function () { return api.blend(NIGHT_RED, DAY_RED); },
    redRGB: function () {
      var c = api.blend(NIGHT_RED, DAY_RED);
      return Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]);
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