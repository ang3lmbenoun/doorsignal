import React from 'react';

// Live campus scene: a photoreal plate (1536x1024) with live layers on top.
// Coordinates below are in plate pixels. Tune ROADS/SPOTS with ?debug=1 (click logs a point).
const W = 1536, H = 1024;
const PLATES = { night: '/img/campus-plate.jpg' }; // add day/dusk plates here when generated
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
  const stage = React.useRef(null), canvas = React.useRef(null);
  const [view, setView] = React.useState({ s: 1, x: 0, y: 0 });
  const [hour, setHour] = React.useState(() => new Date().getHours() + new Date().getMinutes() / 60);
  const [manual, setManual] = React.useState(false);
  const [hot, setHot] = React.useState(null);
  const drag = React.useRef(null), moved = React.useRef(0), pts = React.useRef(new Map());
  const debug = typeof window !== 'undefined' && /[?&]debug=1/.test(window.location.search);
  const ph = phaseFor(hour);

  React.useEffect(() => { if (manual) return undefined; const t = setInterval(() => setHour(new Date().getHours() + new Date().getMinutes() / 60), 30000); return () => clearInterval(t); }, [manual]);

  // moving cars (lights + body), drawn in plate space; day dims lights
  React.useEffect(() => {
    const c = canvas.current; if (!c) return undefined;
    const g = c.getContext('2d'); const path = buildPath(ROAD);
    const cars = Array.from({ length: 16 }, (_, i) => ({ d: (path.total / 16) * i + (i % 3) * 11, v: 28 + (i * 7) % 22, lane: i % 2 ? 7 : -7, dir: i % 2 ? 1 : -1, hue: i % 4 }));
    let raf, last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      g.clearRect(0, 0, W, H);
      const night = hourRef.current < 6 || hourRef.current >= 18.5 ? 1 : hourRef.current >= 17 ? 0.7 : 0.25;
      cars.forEach((car) => {
        car.d += car.v * dt * car.dir;
        const p = at(path, car.d, car.lane), s = 0.75 + (p.y / H) * 0.6;
        const a = p.a + (car.dir < 0 ? Math.PI : 0);
        g.save(); g.translate(p.x, p.y); g.rotate(a);
        g.fillStyle = ['rgba(20,22,28,.85)', 'rgba(70,20,20,.85)', 'rgba(30,40,60,.85)', 'rgba(90,90,95,.8)'][car.hue];
        g.fillRect(-7 * s, -3 * s, 14 * s, 6 * s);
        g.globalCompositeOperation = 'lighter';
        const hl = g.createRadialGradient(7 * s, 0, 0, 7 * s, 0, 14 * s); hl.addColorStop(0, `rgba(255,236,190,${0.9 * night})`); hl.addColorStop(1, 'rgba(255,236,190,0)');
        g.fillStyle = hl; g.fillRect(-4 * s, -14 * s, 30 * s, 28 * s);
        const tl = g.createRadialGradient(-7 * s, 0, 0, -7 * s, 0, 8 * s); tl.addColorStop(0, `rgba(255,60,50,${0.85 * night})`); tl.addColorStop(1, 'rgba(255,60,50,0)');
        g.fillStyle = tl; g.fillRect(-16 * s, -8 * s, 16 * s, 16 * s);
        g.restore();
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
          <img src={PLATES.night} alt="Aerial view of the apartment campus at dusk" draggable={false} style={{ filter: dayish ? 'brightness(1.35) saturate(.85)' : 'none' }} />
          <div className="cl-tint" style={{ background: tint }} />
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
