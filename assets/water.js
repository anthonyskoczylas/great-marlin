/* ============================================================================
   water.js — mouse-disturbed water behind the dark chapters.

   WHAT THIS IS
   A height-field fluid sim on a fullscreen quad, rendered as lit water over a
   flat base colour. The pointer does not draw a cursor — it drops energy into
   the surface, and the surface carries it. Same class of effect Feadship runs
   behind their dark blue sections, implemented from the standard techniques
   (Hugo-Elias wave equation + line SDF + fresnel), in raw WebGL2. No Three.js:
   this is two triangles and a ping-pong framebuffer, and Three would cost 881KB
   to draw them.

   TWO PASSES PER FRAME
   1. SIM   — inject along the segment last->current pointer (a LINE, not a dot,
              so a fast flick leaves a continuous wake instead of dotted stamps),
              then propagate: new = avg(4 neighbours) - previous, damped.
              Signed height is stored *0.5+0.5; .x = current, .y = previous. One
              texture carries its own history, so we ping-pong two, not four.
   2. LIGHT — height -> normal by finite differences -> fresnel + specular +
              diffuse over uBaseColor. The base is a COLOUR, not a photo, which
              is the whole trick: it only reads as water because the room is
              already dark blue.

   COST CONTROL — this must never tax a phone or a laptop on battery:
   - sim runs at a capped low resolution; ripples are smooth, pixels are wasted.
   - rAF STOPS when the surface is still, the tab is hidden, or the canvas is
     scrolled out of view. Idle cost is zero, not "cheap".
   - disabled outright: reduced-motion, coarse pointers (a finger has no hover,
     so there is nothing to track), no WebGL2, or a failed context.
   In every disabled path the page is untouched — the canvas simply never paints
   and the CSS background shows through. Nothing here is load-bearing for content.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = {
    simScale: 0.42,      // sim res as a fraction of css px (capped below)
    simMax: 640,         // hard ceiling on the sim's long edge
    /* "Cinematic" tune (owner-picked in water-lab.html, 2026-07-16): chase the
       glassy near-mirror stillness of the orbit render. Calmer than the first
       tune on every axis — lower displace/light/shadow = flatter, glassier
       surface; bigger, gentler ripples that die sooner. base stays #0d1322:
       we match the CGI's BEHAVIOUR, not its pale fog colour — this water lives
       in the dark rooms. */
    damping: 0.988,      // <1. closer to 1 = ripples ring longer
    /* inject: measured. at 0.055 a pointer that moves then stops drives the
       crest to peak 0.95 against a clamp of 1.0 — it flat-tops and glares.
       0.013 lands a dwell well under ~0.3 and keeps fast strokes gentle, which
       is what reads as an expensive, heavy surface. */
    inject: 0.013,
    size: 1.75,          // ripple radius under the pointer
    displace: 0.72,      // how hard the surface bends what it lights
    light: 0.92,         // specular/diffuse gain
    shadow: 0.46,        // trough darkening
    base: [0.051, 0.075, 0.133], // #0d1322 — must track --bg
    /* idleFrames: how long we keep stepping after the pointer stops. must be
       long enough for the surface to actually FLATTEN, or the loop halts
       mid-ripple and the canvas freezes with a wave painted on it. at damping
       0.992 the crest needs ~300 frames (~5s) to fall to ~4%. shorter is not
       cheaper, it is just visibly broken. */
    idleFrames: 300
  };

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (reduced || !fine) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'water';
  canvas.setAttribute('aria-hidden', 'true');

  var gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'low-power', preserveDrawingBuffer: false
  });
  if (!gl) return; // no WebGL2 — CSS background stands, page is fine

  /* float targets keep the wave alive; RGBA8 quantises height to 1/255 and the
     ripple dies visibly early. degrade rather than bail — 8-bit still reads. */
  var floatOK = !!gl.getExtension('EXT_color_buffer_float');
  if (floatOK) gl.getExtension('OES_texture_float_linear');
  var IFMT = floatOK ? gl.RGBA16F : gl.RGBA8;
  var TYPE = floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  var VERT =
    '#version 300 es\n' +
    'in vec2 p; out vec2 vUv;' +
    'void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';

  var SIM =
    '#version 300 es\nprecision highp float;\n' +
    'in vec2 vUv; out vec4 frag;' +
    'uniform sampler2D uPrev;' +
    'uniform vec2 uTexel;' +
    'uniform vec2 uMouse;' +      // 0..1
    'uniform vec2 uLastMouse;' +
    'uniform float uAspect;' +
    'uniform float uDown;' +      // 0 = pointer absent, 1 = present
    'uniform float uInject;' +
    'uniform float uSize;' +
    'uniform float uDamping;' +
    'uniform int uFrame;' +

    /* distance to the segment a->b, aspect-corrected so ripples stay circular
       on a wide viewport instead of stretching into ovals. */
    'float sdSeg(vec2 p, vec2 a, vec2 b){' +
    '  vec2 s = vec2(uAspect, 1.0);' +
    '  vec2 pa = (p - a) * s, ba = (b - a) * s;' +
    '  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);' +
    '  return length(pa - ba * h);' +
    '}' +

    'void main(){' +
    '  vec4 c = texture(uPrev, vUv);' +
    '  float cur = c.x * 2.0 - 1.0;' +   // decode signed height
    '  float prev = c.y * 2.0 - 1.0;' +

    /* wave equation: the next height is the neighbourhood average minus where
       this texel was last frame. that subtraction is what makes it oscillate
       instead of just blurring outward. */
    '  float l = texture(uPrev, vUv - vec2(uTexel.x, 0.0)).x * 2.0 - 1.0;' +
    '  float r = texture(uPrev, vUv + vec2(uTexel.x, 0.0)).x * 2.0 - 1.0;' +
    '  float t = texture(uPrev, vUv + vec2(0.0, uTexel.y)).x * 2.0 - 1.0;' +
    '  float b = texture(uPrev, vUv - vec2(0.0, uTexel.y)).x * 2.0 - 1.0;' +
    '  float next = (l + r + t + b) * 0.5 - prev;' +
    '  next *= uDamping;' +

    /* Inject along the pointer's travel this frame.
       NOTE the shape of this smoothstep. The obvious spelling is
         smoothstep(radius, 0.0, d)
       to get "1 at the centre, 0 at the edge" — and GLSL says results are
       UNDEFINED when edge0 >= edge1. Some drivers quietly do the reverse ramp
       you wanted; this one returns 0, so the whole effect renders dead flat with
       no error anywhere. Measured, not guessed. Keep the subtraction. */
    '  float d = sdSeg(vUv, uLastMouse, uMouse);' +
    '  float hit = 1.0 - smoothstep(0.0, 0.035 * uSize, d);' +
    '  next += hit * uInject * uDown;' +

    '  next *= float(uFrame > 4);' + // let the buffers settle before believing them

    /* Hard clamp. The wave equation above sits exactly on its stability limit,
       so anything unexpected — a pathological dt, a driver quirk, a config the
       next person tunes too far — diverges instead of degrading. Measured a run
       to height 3.57 (energy 10 -> 1592) before uDown was tied to movement. The
       clamp is insurance, not the fix, and it costs nothing. */
    '  next = clamp(next, -1.0, 1.0);' +
    '  frag = vec4(next * 0.5 + 0.5, cur * 0.5 + 0.5, 0.0, 1.0);' +
    '}';

  var DRAW =
    '#version 300 es\nprecision highp float;\n' +
    'in vec2 vUv; out vec4 frag;' +
    'uniform sampler2D uSim;' +
    'uniform vec2 uTexel;' +
    'uniform vec3 uBase;' +
    'uniform float uDisplace;' +
    'uniform float uLight;' +
    'uniform float uShadow;' +

    'float h(vec2 uv){ return texture(uSim, uv).x * 2.0 - 1.0; }' +

    'void main(){' +
    /* surface normal from the height gradient. the surface bends the lookup,
       which is what sells refraction rather than a painted-on highlight. */
    '  float hx = h(vUv + vec2(uTexel.x, 0.0)) - h(vUv - vec2(uTexel.x, 0.0));' +
    '  float hy = h(vUv + vec2(0.0, uTexel.y)) - h(vUv - vec2(0.0, uTexel.y));' +
    '  vec3 n = normalize(vec3(-hx * 40.0, -hy * 40.0, 1.0));' +

    '  vec2 uv2 = vUv + vec2(hx, hy) * uDisplace * 0.06;' +
    '  float hh = h(uv2);' +

    '  vec3 L = normalize(vec3(-0.45, 0.75, 0.62));' +   // key light, up-left
    '  vec3 V = vec3(0.0, 0.0, 1.0);' +
    '  float diff = max(dot(n, L), 0.0);' +
    '  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 42.0);' +
    /* fresnel: grazing angles catch more light. cheap, and it is most of why
       water looks like water. */
    '  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);' +

    '  vec3 col = uBase;' +
    '  col += (diff * 0.05 + spec * 0.85 + fres * 0.30) * uLight * max(hh, 0.0) * 2.0;' +
    '  col += spec * uLight * 0.06;' +                    // a little sheen on the crests
    '  col -= max(-hh, 0.0) * uShadow * 0.10;' +          // troughs go deeper
    '  frag = vec4(col, 1.0);' +
    '}';

  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[water] shader:', gl.getShaderInfoLog(s)); return null;
    }
    return s;
  }
  function prog(vs, fs) {
    var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[water] link:', gl.getProgramInfoLog(p)); return null;
    }
    return p;
  }

  var pSim = prog(VERT, SIM), pDraw = prog(VERT, DRAW);
  if (!pSim || !pDraw) return; // shader trouble — bail silently, page unaffected

  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ['uPrev','uTexel','uMouse','uLastMouse','uAspect','uDown','uInject','uSize','uDamping','uFrame']
    .forEach(function (k) { U[k] = gl.getUniformLocation(pSim, k); });
  var D = {};
  ['uSim','uTexel','uBase','uDisplace','uLight','uShadow']
    .forEach(function (k) { D[k] = gl.getUniformLocation(pDraw, k); });

  var fbo = [gl.createFramebuffer(), gl.createFramebuffer()];
  var tex = [null, null];
  var simW = 1, simH = 1, cur = 0, frame = 0;

  function mkTex(w, h) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, IFMT, w, h, 0, gl.RGBA, TYPE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  var sized = false;

  function resize() {
    var w = innerWidth, h = innerHeight;

    /* A zero-size viewport is real: a restored background tab, a display-none
       ancestor, a pane mid-layout. Clamping to 1 here would pin the sim at 1x1
       and, because no resize event necessarily follows, it would stay there
       forever — silently, with no GL error. Bail and let the ResizeObserver
       below re-run us when the window actually has dimensions. */
    if (w < 2 || h < 2) { sized = false; return; }
    sized = true;

    var dpr = Math.min(devicePixelRatio || 1, 1.75);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    var s = CFG.simScale;
    var long = Math.max(w, h) * s;
    if (long > CFG.simMax) s *= CFG.simMax / long;
    simW = Math.max(2, Math.round(w * s));
    simH = Math.max(2, Math.round(h * s));

    for (var i = 0; i < 2; i++) {
      if (tex[i]) gl.deleteTexture(tex[i]);
      tex[i] = mkTex(simW, simH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[i], 0);
      gl.clearColor(0.5, 0.5, 0.0, 1.0); // 0.5 == signed zero
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    frame = 0;
  }

  var DOWN_DECAY = 0.88; // ~30 frames from a re-arm to silence
  var mx = 0.5, my = 0.5, lx = 0.5, ly = 0.5, down = 0, idle = 1e9, running = false;

  addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    mx = e.clientX / innerWidth;
    my = 1.0 - e.clientY / innerHeight; // GL origin is bottom-left
    /* Re-arm the injector on MOVEMENT, not presence. render() decays this every
       frame (see DOWN_DECAY), so a pointer parked on the page stops adding
       energy and the surface settles. Holding it at 1 while the mouse sat still
       pumped the sim to height 3.57 — a stationary cursor slowly blooming into a
       white blob. Water reacts to being disturbed, not to being looked at. */
    down = 1; idle = 0; start();
  }, { passive: true });

  addEventListener('pointerleave', function () { down = 0; }, { passive: true });
  addEventListener('blur', function () { down = 0; });

  /* One frame of GL work, deliberately split out from the rAF scheduling so it
     can be driven directly. Headless/CI renderers freeze rAF (measured: 0 frames
     in 1.5s), which makes "it looks fine" untestable there — but stepping this
     by hand and reading pixels back talks to the GPU, not the compositor, so the
     physics can still be proven. window.__water.step() is that door. */
  function render() {
    // ---- sim pass
    gl.useProgram(pSim);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, simW, simH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - cur]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex[cur]);
    gl.uniform1i(U.uPrev, 0);
    gl.uniform2f(U.uTexel, 1 / simW, 1 / simH);
    gl.uniform2f(U.uMouse, mx, my);
    gl.uniform2f(U.uLastMouse, lx, ly);
    gl.uniform1f(U.uAspect, simW / simH);
    gl.uniform1f(U.uDown, down);
    gl.uniform1f(U.uInject, CFG.inject);
    gl.uniform1f(U.uSize, CFG.size);
    gl.uniform1f(U.uDamping, CFG.damping);
    gl.uniform1i(U.uFrame, frame);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;

    // ---- light pass
    gl.useProgram(pDraw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex[cur]);
    gl.uniform1i(D.uSim, 0);
    gl.uniform2f(D.uTexel, 1 / simW, 1 / simH);
    gl.uniform3f(D.uBase, CFG.base[0], CFG.base[1], CFG.base[2]);
    gl.uniform1f(D.uDisplace, CFG.displace);
    gl.uniform1f(D.uLight, CFG.light);
    gl.uniform1f(D.uShadow, CFG.shadow);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    lx = mx; ly = my; frame++;
    /* Decay the injector. A moving pointer re-arms it to 1 on every pointermove
       (many per second), so a real stroke stays fed; a parked one fades out in
       ~30 frames. Total energy from a dwell is bounded by inject/(1-decay)
       instead of unbounded. */
    down *= DOWN_DECAY;
    if (down < 0.002) down = 0;
  }

  function tick() {
    if (!running) return;
    if (!sized) { resize(); if (!sized) { running = false; return; } }
    render();
    /* stop once the pointer has been still long enough that the surface has
       flattened. an idle tab must cost nothing — this effect is a flourish and
       it does not get to keep a GPU awake. */
    if (++idle > CFG.idleFrames) { running = false; down = 0; return; }
    requestAnimationFrame(tick);
  }

  function start() { if (!running) { running = true; requestAnimationFrame(tick); } }

  addEventListener('resize', function () { resize(); start(); }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) running = false; else start();
  });

  /* The resize EVENT does not fire when the viewport goes from zero to real
     without the window itself changing (tab restore, an ancestor un-hiding).
     Observe the element instead so we always recover. */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      if (!sized) { resize(); if (sized) start(); }
    }).observe(document.documentElement);
  }

  document.body.appendChild(canvas);
  resize();
  start();

  // handles for live tuning: window.__water.cfg.inject = 0.09 etc.
  window.__water = {
    cfg: CFG, canvas: canvas, gl: gl,
    float: floatOK,
    sim: function () { return [simW, simH]; },
    running: function () { return running; },
    poke: function (x, y) { mx = x; my = y; lx = x; ly = y; down = 1; idle = 0; start(); },
    // step the sim without rAF (see render()) — for probing where rAF is frozen
    step: function (n) { for (var i = 0; i < (n || 1); i++) render(); },
    // read the signed height field back off the GPU
    readSim: function () {
      var px = new Float32Array(simW * simH * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[cur]);
      gl.readPixels(0, 0, simW, simH, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { w: simW, h: simH, px: px };
    }
  };
})();
