import React from 'react';

// Live campus scene: a photoreal plate (1536x1024) with live layers on top.
// Coordinates below are in plate pixels. Tune ROADS/SPOTS with ?debug=1 (click logs a point).
const W = 1536, H = 1024;
const PLATES = { night: '/img/campus-plate.jpg' }; // add day/dusk plates here when generated
const MASK = '/img/campus-mask.png'; // R = vegetation, G = water, B = cloud/sky
const VERT = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }';
const FRAG = `precision mediump float; varying vec2 vUv; uniform sampler2D uPlate, uMask; uniform float uT, uDay;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUv; vec3 m = texture2D(uMask, uv).rgb;
  float gust = (0.55 + 0.45*sin(uT*0.45 + uv.x*5.0 + uv.y*2.0)) * (0.85 + 0.15*sin(uT*1.7));
  vec2 sw = vec2(sin(uT*1.9 + uv.x*90.0 + uv.y*40.0), 0.6*sin(uT*2.3 + uv.x*60.0 - uv.y*70.0));
  uv += sw * 0.0026 * gust * m.r;
  uv.x += sin(uv.y*420.0 + uT*1.4 + sin(uv.x*30.0 + uT*0.6)*2.0) * 0.0009 * m.g;
  uv.y += cos(uv.x*300.0 + uT*1.1) * 0.0005 * m.g;
  uv.x += sin(uT*0.07) * 0.007 * m.b;
  vec3 col = texture2D(uPlate, uv).rgb;
  float sp = smoothstep(0.9, 1.0, sin(uv.x*700.0 + uT*2.0) * sin(uv.y*520.0 - uT*1.6));
  col += vec3(1.0, 0.72, 0.45) * sp * 0.4 * m.g * exp(-pow((uv.x - 0.95)*3.5, 2.0));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float lamp = smoothstep(0.62, 0.9, lum) * (1.0 - m.b) * step(uv.y, 0.8);
  float cell = hash(floor(uv * vec2(512.0, 341.0)));
  col *= mix(1.0, 0.88 + 0.12*sin(uT*(1.5 + cell*3.0) + cell*40.0), lamp);
  col = col * (1.0 + 0.35*uDay);
  col = mix(vec3(lum), col, 1.0 - 0.15*uDay);
  col = mix(col, col * vec3(0.85, 0.98, 1.15), uDay*0.5);
  gl_FragColor = vec4(col, 1.0);
}`;
const FIXED = typeof window !== 'undefined' && /[?&]fixed=1/.test(window.location.search);
const nowT = () => (FIXED ? (window.__t || 0) : performance.now() / 1000);
const BIRDS = Array.from({ length: 6 }, (_, i) => ({ x0: (i * 311) % 1700, y: 50 + ((i * 37) % 90), v: 26 + (i % 3) * 9, ph: i * 1.7, sz: 5 + (i % 3) * 1.5 }));
const ROAD = [[200, 470], [215, 540], [265, 605], [330, 665], [410, 725], [500, 762], [600, 800], [700, 842], [850, 884], [1000, 903], [1150, 898], [1280, 880], [1350, 862], [1410, 820], [1460, 770], [1500, 715], [1536, 680]];
const SPOTS = [
  { id: 'leases', name: 'Tenants', poly: [[340, 430], [470, 392], [560, 395], [670, 440], [672, 560], [560, 640], [520, 645], [342, 565]] },
  { id: 'overview', name: 'Management', poly: [[555, 290], [620, 262], [740, 262], [808, 290], [806, 395], [745, 440], [640, 440], [556, 395]] },
  { id: 'repairs', name: 'Maintenance', poly: [[1050, 470], [1180, 410], [1285, 408], [1350, 445], [1348, 600], [1230, 690], [1190, 692], [1052, 600]] },
  { id: 'inbox', name: 'Welcome', poly: [[750, 590], [830, 578], [950, 590], [985, 628], [980, 660], [880, 690], [790, 670], [748, 625]] },
];

function phaseFor(h) {
  if (h >= 7 && h < 17) return { name: 'Day', dark: 0, warm: 0.0 };
  if (h >= 17 && h < 20) return { name: 'Dusk', dark: 0.0, warm: 0.0 };
  if (h >= 5 && h < 7) return { name: 'Morning', dark: 0.1, warm: 0.1 };
  return { name: 'Night', dark: 0.0, warm: 0 };
}

function buildPath(pts) {
  const seg = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
  return { pts, seg, total };
}
function at(path, d, lane) {
  let dd = ((d % path.total) + path.total) % path.total, i = 0;
  while (i < path.seg.length - 1 && dd > path.seg[i]) { dd -= path.seg[i]; i++; }
  const [x0, y0] = path.pts[i], [x1, y1] = path.pts[i + 1], t = dd / path.seg[i];
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  return { x: x0 + dx * t + (-dy / len) * lane, y: y0 + dy * t + (dx / len) * lane, a: Math.atan2(dy, dx) };
}

export default function CampusLive({ stats = {}, can = () => true }) {
  const stage = React.useRef(null), canvas = React.useRef(null), glc = React.useRef(null);
  const [glOk, setGlOk] = React.useState(true);
  const [view, setView] = React.useState({ s: 1, x: 0, y: 0 });
  const [hour, setHour] = React.useState(() => { const q = /[?&]hour=([\d.]+)/.exec(window.location.search); return q ? Number(q[1]) : new Date().getHours() + new Date().getMinutes() / 60; });
  const [manual, setManual] = React.useState(false);
  const [hot, setHot] = React.useState(null);
  const drag = React.useRef(null), moved = React.useRef(0), pts = React.useRef(new Map());
  const debug = typeof window !== 'undefined' && /[?&]debug=1/.test(window.location.search);
  const ph = phaseFor(hour);

  React.useEffect(() => { if (manual) return undefined; const t = setInterval(() => setHour(new Date().getHours() + new Date().getMinutes() / 60), 30000); return () => clearInterval(t); }, [manual]);

  // WebGL layer: wind sway on vegetation, water ripple, cloud drift, light twinkle (masked, shader-driven)
  React.useEffect(() => {
    const c = glc.current; if (!c) return undefined;
    const gl = c.getContext('webgl', { antialias: false });
    if (!gl) { setGlOk(false); return undefined; }
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { setGlOk(false); return undefined; }
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const tex = (unit, url, name) => new Promise((res) => {
      const im = new Image(); im.onload = () => {
        const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
        [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
        [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
        gl.uniform1i(gl.getUniformLocation(pr, name), unit); res(true);
      }; im.onerror = () => res(false); im.src = url;
    });
    let raf, dead = false;
    Promise.all([tex(0, PLATES.night, 'uPlate'), tex(1, MASK, 'uMask')]).then(([a, b]) => {
      if (dead) return; if (!a || !b) { setGlOk(false); return; }
      const uT = gl.getUniformLocation(pr, 'uT'), uD = gl.getUniformLocation(pr, 'uDay');
      const draw = () => {
        const h = hourRef.current;
        const day = h >= 7 && h < 17 ? 1 : h >= 5 && h < 7 ? (h - 5) / 2 : h >= 17 && h < 19 ? 1 - (h - 17) / 2 : 0;
        gl.viewport(0, 0, c.width, c.height); gl.uniform1f(uT, nowT()); gl.uniform1f(uD, day);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); raf = requestAnimationFrame(draw);
      };
      draw();
    });
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, []);

  // moving cars (body + light streaks) and birds, drawn in plate space; positions are a pure function of time
  React.useEffect(() => {
    const c = canvas.current; if (!c) return undefined;
    const g = c.getContext('2d'); const path = buildPath(ROAD);
    const cars = Array.from({ length: 18 }, (_, i) => ({ d0: (path.total / 18) * i + (i % 3) * 11, v: 26 + (i * 7) % 22, lane: i % 2 ? 8 : -8, dir: i % 2 ? 1 : -1, hue: i % 4 }));
    let raf;
    const frame = () => {
      const t = nowT(), h = hourRef.current;
      g.clearRect(0, 0, W, H);
      const night = h < 6 || h >= 18.5 ? 1 : h >= 17 ? 0.7 : h >= 6 && h < 7 ? 0.5 : 0.2;
      cars.forEach((car) => {
        const p = at(path, car.d0 + car.v * t * car.dir, car.lane), s = 0.8 + (p.y / H) * 0.6;
        const a = p.a + (car.dir < 0 ? Math.PI : 0);
        g.save(); g.translate(p.x, p.y); g.rotate(a);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-8 * s, -3 * s, 17 * s, 7 * s);
        g.fillStyle = ['#1b1d24', '#5a1a1a', '#1d2a44', '#7a7a80'][car.hue]; g.beginPath(); g.roundRect(-8 * s, -3.5 * s, 16 * s, 7 * s, 2 * s); g.fill();
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-3 * s, -2.4 * s, 7 * s, 4.8 * s);
        g.globalCompositeOperation = 'lighter';
        const st = g.createLinearGradient(8 * s, 0, 8 * s + 30 * s, 0); st.addColorStop(0, `rgba(255,232,180,${0.55 * night})`); st.addColorStop(1, 'rgba(255,232,180,0)');
        g.fillStyle = st; g.fillRect(8 * s, -2.6 * s, 30 * s, 5.2 * s);
        const hl = g.createRadialGradient(8 * s, 0, 0, 8 * s, 0, 12 * s); hl.addColorStop(0, `rgba(255,240,200,${0.95 * night})`); hl.addColorStop(1, 'rgba(255,240,200,0)');
        g.fillStyle = hl; g.fillRect(-4 * s, -13 * s, 28 * s, 26 * s);
        const tl = g.createLinearGradient(-8 * s, 0, -8 * s - 16 * s, 0); tl.addColorStop(0, `rgba(255,50,40,${0.8 * night})`); tl.addColorStop(1, 'rgba(255,50,40,0)');
        g.fillStyle = tl; g.fillRect(-24 * s, -2.4 * s, 16 * s, 4.8 * s);
        g.restore();
      });
      const birdA = h >= 5.5 && h < 20.5 ? 0.85 : 0;
      if (birdA > 0) BIRDS.forEach((b) => {
        const x = ((b.x0 + b.v * t) % (W + 240)) - 120, y = b.y + Math.sin(t * 0.6 + b.ph) * 8, f = Math.sin(t * 9 + b.ph) * b.sz * 0.7;
        g.strokeStyle = `rgba(14,10,18,${birdA})`; g.lineWidth = 1.6; g.lineCap = 'round'; g.beginPath();
        g.moveTo(x - b.sz, y - f); g.quadraticCurveTo(x - b.sz * 0.4, y - f * 0.2 - 2, x, y); g.quadraticCurveTo(x + b.sz * 0.4, y - f * 0.2 - 2, x + b.sz, y - f); g.stroke();
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  const hourRef = React.useRef(hour); hourRef.current = hour;

  const clamp = (v) => { const r = stage.current.getBoundingClientRect(); const s = Math.min(4, Math.max(1, v.s)); return { s, x: Math.min(0, Math.max(r.width * (1 - s), v.x)), y: Math.min(0, Math.max(r.height * (1 - s), v.y)) }; };
  const zoomAt = (f, cx, cy) => setView((v) => { const s = Math.min(4, Math.max(1, v.s * f)); const k = s / v.s; return clamp({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }); });
  const onWheel = (e) => { e.preventDefault(); const r = stage.current.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); };
  React.useEffect(() => { const el = stage.current; el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); });
  const down = (e) => { stage.current.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, [e.clientX, e.clientY]); moved.current = 0; drag.current = { x: e.clientX, y: e.clientY, v: view, d: null }; };
  const move = (e) => {
    if (!pts.current.has(e.pointerId)) return;
    const prev = pts.current.get(e.pointerId); pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    const all = [...pts.current.values()];
    if (all.length === 2) {
      const d = Math.hypot(all[0][0] - all[1][0], all[0][1] - all[1][1]);
      if (drag.current.d) { const r = stage.current.getBoundingClientRect(); zoomAt(d / drag.current.d, (all[0][0] + all[1][0]) / 2 - r.left, (all[0][1] + all[1][1]) / 2 - r.top); }
      drag.current.d = d; moved.current = 99; return;
    }
    moved.current += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
    setView((v) => clamp({ ...v, x: v.x + e.clientX - prev[0], y: v.y + e.clientY - prev[1] }));
  };
  const up = (e) => { pts.current.delete(e.pointerId); if (drag.current) drag.current.d = null; };

  const spotInfo = (id) => ({
    overview: [`${stats.drafts ?? '–'} drafts waiting`, 'Portfolio signals and approvals'],
    leases: [`${stats.renewal ?? '–'} high renewal risk`, 'Leases, renewals and risk'],
    repairs: [`${stats.repairs ?? '–'} repairs past 7 days`, 'Work orders and follow-ups'],
    inbox: ['Resident complaints', 'Front desk and replies'],
  }[id]);
  const click = (e, sp) => { if (moved.current > 6) return; e.stopPropagation(); setHot(sp.id); };
  const night = hour < 6 || hour >= 18.5, dayish = hour >= 7 && hour < 17;
  const tint = dayish ? 'rgba(120,170,230,.22)' : hour >= 5 && hour < 7 ? 'rgba(255,190,140,.14)' : 'transparent';

  return (
    <section className="clive" aria-label="Interactive campus scene">
      <div ref={stage} className="cl-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClick={(e) => { if (debug) { const r = stage.current.getBoundingClientRect(); const px = ((e.clientX - r.left - view.x) / (r.width * view.s)) * W; const py = ((e.clientY - r.top - view.y) / (r.height * view.s)) * H; console.log(`[${Math.round(px)}, ${Math.round(py)}]`); } else setHot(null); }}>
        <div className="cl-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.s})` }}>
          {glOk ? <canvas ref={glc} className="cl-gl" width={W} height={H} role="img" aria-label="Aerial view of the apartment campus" />
            : <img src={PLATES.night} alt="Aerial view of the apartment campus at dusk" draggable={false} style={{ filter: dayish ? 'brightness(1.35) saturate(.85)' : 'none' }} />}
          <canvas ref={canvas} width={W} height={H} />
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {SPOTS.filter((sp) => can(sp.id) || sp.id === 'inbox').map((sp) => (
              <polygon key={sp.id} className={`cl-spot${hot === sp.id ? ' on' : ''}`} points={sp.poly.map((p) => p.join(',')).join(' ')}
                tabIndex={0} role="link" aria-label={sp.name} onClick={(e) => click(e, sp)} onKeyDown={(e) => { if (e.key === 'Enter') setHot(sp.id); }} />
            ))}
            {debug ? <polyline points={ROAD.map((p) => p.join(',')).join(' ')} fill="none" stroke="#0f0" strokeWidth="3" /> : null}
          </svg>
        </div>
        {hot ? (() => { const sp = SPOTS.find((x) => x.id === hot); const [a, b] = spotInfo(hot); return (
          <div className="cl-card" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <strong>{sp.name}</strong><b>{a}</b><span>{b}</span>
            <a className="chipbtn" href={`#${hot}`}>Open {sp.name.toLowerCase()} →</a>
          </div>); })() : null}
        <div className="cl-ctl" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button aria-label="Zoom in" onClick={() => zoomAt(1.4, stage.current.clientWidth / 2, stage.current.clientHeight / 2)}>+</button>
          <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.4, stage.current.clientWidth / 2, stage.current.clientHeight / 2)}>−</button>
          <button aria-label="Reset view" onClick={() => setView({ s: 1, x: 0, y: 0 })}>⟲</button>
        </div>
        <div className="cl-time" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <span>{ph.name}{night || dayish ? '' : ''}{Object.keys(PLATES).length < 2 ? ' · preview lighting' : ''}</span>
          <input type="range" min="0" max="23.9" step="0.1" value={hour} aria-label="Time of day" onChange={(e) => { setManual(true); setHour(Number(e.target.value)); }} />
          {manual ? <button onClick={() => { setManual(false); setHour(new Date().getHours()); }}>Live</button> : null}
        </div>
      </div>
    </section>
  );
}
