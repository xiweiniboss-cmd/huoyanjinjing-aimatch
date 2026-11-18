/* 冠军行火焰：低分辨率 Canvas2D 连续场。无外部库、无视频或图片网络依赖。
 * 视觉参考仅用于学习（https://commons.wikimedia.org/wiki/File:Fire_burning.ogv），不复用该资产。 */
(function (root) {
  'use strict';

  var FIELD_W = 128;
  var FIELD_H = 56;
  var FIELD_W_NARROW = 96;
  var FIELD_H_NARROW = 44;
  var FPS = 24;
  var FPS_NARROW = 16;
  var NARROW_CSS = 420;
  var MAX_EMBERS = 6;
  var STATIC_TIME = 1.7;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function hash2(ix, iy, seed) {
    var n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function vnoise(x, y, seed) {
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var fx = fade(x - x0);
    var fy = fade(y - y0);
    var a = hash2(x0, y0, seed);
    var b = hash2(x0 + 1, y0, seed);
    var c = hash2(x0, y0 + 1, seed);
    var d = hash2(x0 + 1, y0 + 1, seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  function fbm(x, y, seed, octaves) {
    var sum = 0, amp = 0.5, f = 1, norm = 0, i;
    for (i = 0; i < octaves; i++) {
      sum += amp * vnoise(x * f, y * f, seed + i * 19);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / (norm || 1);
  }

  /* 列向原始峰高：只提供不对称起伏。真正冲顶靠 paintField 里的 shapePeaks。 */
  function peakHeight(u, t) {
    var body = 0.34 + 0.20 * fbm(u * 2.05 + t * 0.06, t * 0.04, 3, 3);
    var ridge = fbm(u * 3.35 + t * 0.085, 0.18 + t * 0.03, 17, 3);
    var detail = Math.abs(fbm(u * 7.4 + t * 0.2, 0.7, 13, 2) - 0.5) * 2;
    return body + 0.42 * ridge + 0.08 * detail;
  }

  /* 拉开当帧左右对比：最低峰留在中低部，最高峰越过行顶，避免齐高或整排半高。 */
  function shapePeaks(peaks) {
    var n = peaks.length, i, lo = 1, hi = 0, span, x;
    if (!n) return peaks;
    for (i = 0; i < n; i++) {
      if (peaks[i] < lo) lo = peaks[i];
      if (peaks[i] > hi) hi = peaks[i];
    }
    span = Math.max(hi - lo, 0.12);
    for (i = 0; i < n; i++) {
      x = (peaks[i] - lo) / span;
      peaks[i] = 0.38 + 0.14 * x + 0.58 * Math.pow(x, 1.75);
    }
    return peaks;
  }

  /* 底部缓慢游走的小热点，保证多数帧都有小面积亮芯，而不是整条底边变黄。 */
  function coreParams(t) {
    return {
      c1: 0.16 + 0.22 * fbm(t * 0.045, 0.2, 91, 2),
      c2: 0.46 + 0.18 * fbm(0.4 + t * 0.038, 1.7, 97, 2),
      c3: 0.78 + 0.16 * fbm(1.1 + t * 0.041, 3.3, 103, 2),
      w1: 0.07 + 0.03 * fbm(0.2, t * 0.05, 107, 2),
      w2: 0.06 + 0.03 * fbm(2.2, t * 0.05, 109, 2),
      w3: 0.065 + 0.03 * fbm(4.2, t * 0.05, 113, 2)
    };
  }

  function coreWeight(u, v, t, p) {
    p = p || coreParams(t);
    var d1 = (u - p.c1) / p.w1;
    var d2 = (u - p.c2) / p.w2;
    var d3 = (u - p.c3) / p.w3;
    var lateral = Math.max(Math.exp(-d1 * d1), Math.exp(-d2 * d2), Math.exp(-d3 * d3));
    var flicker = 0.86 + 0.14 * fbm(u * 5.2 + t * 0.28, v * 2 + t * 0.33, 127, 2);
    return Math.pow(v, 4.4) * lateral * flicker;
  }

  function sampleField(u, v, t, peak, coreP) {
    var fromBottom = 1 - v;
    var env = 1 - smoothstep(peak - 0.14, peak + 0.02, fromBottom);

    var wx = fbm(u * 3.1 + t * 0.16, v * 2.2, 11, 2) - 0.5;
    var wy = fbm(u * 2.2, v * 3.0 + t * 0.42, 23, 2) - 0.5;
    var xw = u + wx * 0.13;
    var yw = v + wy * 0.08;

    var body = fbm(xw * 3.8, yw * 2.8 + t * 0.82, 31, 3);
    var turb = Math.abs(fbm(xw * 6.6, yw * 5.2 + t * 1.18, 47, 2) * 2 - 1);
    var interior = body * 0.58 + (1 - turb) * 0.42;

    var base = Math.pow(v, 1.2);
    var tip = smoothstep(0.42, 0.95, fromBottom / Math.max(peak, 0.08));
    var brk = fbm(xw * 9.2, yw * 6.1 + t * 1.55, 59, 2);

    var intensity = env * (0.30 + 0.70 * interior);
    intensity *= 1 - tip * (0.10 + 0.32 * brk);
    if (tip > 0.62 && tip < 0.97 && brk > 0.70) intensity *= 0.10;
    intensity = clamp(intensity, 0, 1);
    return { intensity: intensity, tip: tip, base: base, env: env, core: coreWeight(u, v, t, coreP) };
  }

  /* 视觉配色，不是温度测量。底部稳定出现小面积亮黄芯，中层橙色，火舌向顶变细变透。 */
  function colorize(sample) {
    var intensity = sample.intensity;
    var tip = sample.tip;
    var base = sample.base;
    var env = sample.env == null ? 1 : sample.env;
    var core = sample.core || 0;
    var heat = intensity * (0.58 + 0.18 * base);
    heat = clamp(heat + 0.55 * core * (0.50 + 0.50 * intensity) * env, 0, 1);

    var r, g, b;
    if (heat < 0.35) {
      var k = heat / 0.35;
      r = lerp(80, 176, k);
      g = lerp(16, 42, k);
      b = lerp(8, 16, k);
    } else if (heat < 0.7) {
      var k2 = (heat - 0.35) / 0.35;
      r = lerp(176, 230, k2);
      g = lerp(42, 102, k2);
      b = lerp(16, 28, k2);
    } else if (heat < 0.88) {
      var k3 = (heat - 0.7) / 0.18;
      r = lerp(230, 252, k3);
      g = lerp(102, 196, k3);
      b = lerp(28, 78, k3);
    } else {
      var k4 = Math.min(1, (heat - 0.88) / 0.12);
      r = lerp(252, 255, k4);
      g = lerp(196, 232, k4);
      b = lerp(78, 150, k4);
    }

    var alpha = Math.pow(intensity, 0.9);
    var band = 0.48 + 0.52 * Math.pow(base, 0.58);
    alpha *= band;
    alpha *= 1 - tip * 0.14;
    alpha = Math.min(alpha, base > 0.72 ? 0.94 : (base > 0.38 ? 0.72 : 0.48));
    if (alpha < 0.01) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
      a: Math.round(alpha * 255)
    };
  }

  function paintField(data, w, h, t, embers) {
    var x, y, i, u, v, peak, sample, col, p, e, ex, ey, dx, dy, fall, ia;
    var peaks = new Float32Array(w);
    var coreP = coreParams(t);
    for (x = 0; x < w; x++) peaks[x] = peakHeight(w === 1 ? 0 : x / (w - 1), t);
    shapePeaks(peaks);

    for (y = 0; y < h; y++) {
      v = h === 1 ? 1 : y / (h - 1);
      for (x = 0; x < w; x++) {
        u = w === 1 ? 0 : x / (w - 1);
        sample = sampleField(u, v, t, peaks[x], coreP);
        col = colorize(sample);
        i = (y * w + x) * 4;
        data[i] = col.r;
        data[i + 1] = col.g;
        data[i + 2] = col.b;
        data[i + 3] = col.a;
      }
    }

    if (!embers) return;
    for (p = 0; p < embers.length; p++) {
      e = embers[p];
      if (!e || e.life <= 0) continue;
      ex = e.x * (w - 1);
      ey = e.y * (h - 1);
      fall = Math.sin(Math.min(1, e.life) * Math.PI);
      for (dy = -1; dy <= 1; dy++) {
        for (dx = -1; dx <= 1; dx++) {
          x = Math.round(ex + dx);
          y = Math.round(ey + dy);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          ia = fall * (dx === 0 && dy === 0 ? 0.85 : 0.28) * 255;
          i = (y * w + x) * 4;
          data[i] = Math.min(255, data[i] + 40);
          data[i + 1] = Math.min(255, data[i + 1] + 28);
          data[i + 2] = Math.min(255, data[i + 2] + 10);
          data[i + 3] = Math.min(255, data[i + 3] + ia);
        }
      }
    }
  }

  function shouldSchedule(s) {
    return !!(s.canvasOk && !s.reducedMotion && s.panelActive && s.inView && !s.documentHidden);
  }

  function stepEmbers(embers, t, dt) {
    var i, e, spawn;
    for (i = 0; i < embers.length; i++) {
      e = embers[i];
      e.life -= dt * e.decay;
      e.y -= dt * e.vy;
      e.x += dt * e.vx;
      if (e.life <= 0 || e.y < 0.02) {
        spawn = (t * 13 + i * 7) % 1;
        if (spawn > 0.55) {
          e.x = 0.08 + hash2(Math.floor(t * 17 + i * 3), i + 4, 101) * 0.84;
          e.y = 0.72 + hash2(i + 9, Math.floor(t * 9), 203) * 0.2;
          e.life = 0.7 + hash2(i, Math.floor(t * 5), 307) * 0.7;
          e.decay = 0.55 + hash2(i + 2, 8, 409) * 0.5;
          e.vy = 0.18 + hash2(i + 3, 11, 503) * 0.22;
          e.vx = (hash2(i + 5, 12, 601) - 0.5) * 0.08;
        } else {
          e.life = 0;
        }
      }
    }
  }

  function makeEmbers() {
    var list = [];
    var i;
    for (i = 0; i < MAX_EMBERS; i++) {
      list.push({ x: 0.5, y: 1, life: 0, decay: 1, vy: 0.2, vx: 0 });
    }
    return list;
  }

  var api = {
    FIELD_W: FIELD_W,
    FIELD_H: FIELD_H,
    FIELD_W_NARROW: FIELD_W_NARROW,
    FIELD_H_NARROW: FIELD_H_NARROW,
    FPS: FPS,
    FPS_NARROW: FPS_NARROW,
    STATIC_TIME: STATIC_TIME,
    hash2: hash2,
    vnoise: vnoise,
    fbm: fbm,
    peakHeight: peakHeight,
    shapePeaks: shapePeaks,
    coreParams: coreParams,
    coreWeight: coreWeight,
    sampleField: sampleField,
    colorize: colorize,
    paintField: paintField,
    shouldSchedule: shouldSchedule,
    stepEmbers: stepEmbers,
    makeEmbers: makeEmbers
  };

  function mount() {
    var row = document.querySelector('.row.champion-flame');
    if (!row) return;

    var layer = row.querySelector('.champion-fire');
    var canvas = row.querySelector('.champion-fire-canvas');
    var fallback = row.querySelector('.champion-fire-static');
    var panel = document.getElementById('panel-players');
    if (!layer) return;

    var reducedMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var state = {
      canvasOk: false,
      reducedMotion: !!(reducedMq && reducedMq.matches),
      panelActive: !!(panel && panel.classList.contains('active')),
      inView: false,
      documentHidden: !!document.hidden
    };

    var ctx = null;
    var field = null;
    var image = null;
    var fw = FIELD_W;
    var fh = FIELD_H;
    var embers = makeEmbers();
    var raf = 0;
    var lastTs = 0;
    var acc = 0;
    var time = 0;
    var gap = 1000 / FPS;

    function showFallback() {
      if (canvas) canvas.hidden = true;
      if (fallback) fallback.hidden = false;
    }

    function showCanvas() {
      if (canvas) canvas.hidden = false;
      if (fallback) fallback.hidden = true;
    }

    function sizeField() {
      var cssW = row.clientWidth || NARROW_CSS + 1;
      var narrow = cssW < NARROW_CSS;
      fw = narrow ? FIELD_W_NARROW : FIELD_W;
      fh = narrow ? FIELD_H_NARROW : FIELD_H;
      gap = 1000 / (narrow ? FPS_NARROW : FPS);
      if (!canvas || !ctx) return;
      if (canvas.width !== fw || canvas.height !== fh) {
        canvas.width = fw;
        canvas.height = fh;
        try {
          image = ctx.createImageData(fw, fh);
          field = image.data;
        } catch (err) {
          state.canvasOk = false;
          showFallback();
        }
      }
    }

    function paint(t) {
      if (!ctx || !field || !image) return;
      try {
        paintField(field, fw, fh, t, embers);
        ctx.putImageData(image, 0, 0);
      } catch (err) {
        state.canvasOk = false;
        stopLoop();
        showFallback();
      }
    }

    function stopLoop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      lastTs = 0;
      acc = 0;
    }

    function loop(ts) {
      raf = 0;
      if (!shouldSchedule(state)) return;
      raf = requestAnimationFrame(loop);
      if (!lastTs) { lastTs = ts; return; }
      var dt = ts - lastTs;
      lastTs = ts;
      if (dt > 250) dt = gap;
      acc += dt;
      var stepped = false;
      while (acc >= gap) {
        acc -= gap;
        time += gap / 1000;
        stepEmbers(embers, time, gap / 1000);
        stepped = true;
        if (acc > gap * 2) acc = 0;
      }
      if (stepped) paint(time);
    }

    function applyMode() {
      if (!state.canvasOk) {
        stopLoop();
        showFallback();
        return;
      }
      showCanvas();
      sizeField();
      if (state.reducedMotion) {
        stopLoop();
        embers = makeEmbers();
        paint(STATIC_TIME);
        return;
      }
      if (shouldSchedule(state)) {
        if (!raf) raf = requestAnimationFrame(loop);
      } else {
        stopLoop();
        if (image && ctx) paint(time || STATIC_TIME);
      }
    }

    function initCanvas() {
      if (!canvas || typeof canvas.getContext !== 'function') {
        state.canvasOk = false;
        return;
      }
      try {
        ctx = canvas.getContext('2d', { alpha: true });
      } catch (err) {
        ctx = null;
      }
      if (!ctx) {
        state.canvasOk = false;
        return;
      }
      state.canvasOk = true;
      canvas.addEventListener('contextlost', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        state.canvasOk = false;
        stopLoop();
        showFallback();
      });
      canvas.addEventListener('contextrestored', function () {
        try {
          ctx = canvas.getContext('2d', { alpha: true });
          state.canvasOk = !!ctx;
        } catch (err) {
          state.canvasOk = false;
        }
        applyMode();
      });
    }

    initCanvas();
    applyMode();

    if (reducedMq) {
      var onReduce = function () {
        state.reducedMotion = !!reducedMq.matches;
        applyMode();
      };
      if (reducedMq.addEventListener) reducedMq.addEventListener('change', onReduce);
      else if (reducedMq.addListener) reducedMq.addListener(onReduce);
    }

    document.addEventListener('visibilitychange', function () {
      state.documentHidden = !!document.hidden;
      applyMode();
    });

    if (panel) {
      if (typeof MutationObserver === 'function') {
        new MutationObserver(function () {
          state.panelActive = panel.classList.contains('active');
          applyMode();
        }).observe(panel, { attributes: true, attributeFilter: ['class'] });
      }
    }

    if (typeof IntersectionObserver === 'function') {
      var io = new IntersectionObserver(function (entries) {
        var e = entries[0];
        state.inView = !!(e && e.isIntersecting && e.intersectionRatio > 0);
        applyMode();
      }, { threshold: 0.01 });
      io.observe(row);
    } else {
      state.inView = true;
      applyMode();
    }

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        var prevW = fw, prevH = fh;
        sizeField();
        if (state.canvasOk && (fw !== prevW || fh !== prevH)) paint(state.reducedMotion ? STATIC_TIME : (time || STATIC_TIME));
      }).observe(row);
    } else if (root.addEventListener) {
      root.addEventListener('resize', function () {
        sizeField();
        if (state.canvasOk) paint(state.reducedMotion ? STATIC_TIME : (time || STATIC_TIME));
      });
    }
  }

  api.mount = mount;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ChampionFlame = api;
    if (root.document) {
      if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', mount);
      } else {
        mount();
      }
    }
  }
})(typeof window !== 'undefined' ? window : this);
