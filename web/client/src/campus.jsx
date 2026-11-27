import React from 'react';
import { getPersonas, list, login } from './api.js';
import { Async, useLoad } from './ui.jsx';

export function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="#d6b06a" strokeWidth="1.6" strokeLinecap="round" role="img" aria-label="DoorSignal logo">
      <path d="M14 41V23a10 10 0 0 1 20 0v18z" /><path d="M8 41h32" /><circle cx="29" cy="32" r="1.4" fill="#d6b06a" stroke="none" />
      <path d="M19 15.5a7 7 0 0 1 10 0" /><path d="M14.5 11a13 13 0 0 1 19 0" /><path d="M10 6.5a19 19 0 0 1 28 0" />
    </svg>
  );
}

export function SignIn({ onDone }) {
  const [people, setPeople] = React.useState(null);
  const [err, setErr] = React.useState(null);
  React.useEffect(() => { getPersonas().then((d) => setPeople(d.personas)).catch((e) => setErr(e.message)); }, []);
  return (
    <main className="login">
      <div className="art"><img src="/img/login.jpg" alt="DoorSignal: smarter property management, stronger communities. A residential building beside a pond at dusk." /></div>
      <div className="panel">
        <div className="box">
          <h1>Welcome Back</h1>
          <p className="sub">Sign in to your DoorSignal account</p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Demo sign-in on synthetic data. There are no passwords: choose a person. Each one sees only what their role allows, enforced by the database.</p>
          {err ? <p className="error" role="alert">{err}</p> : null}
          <div className="people">
            {(people || []).map((p) => (
              <button key={p.id} className="person" onClick={() => login(p.id).then((d) => onDone(d.user)).catch((e) => setErr(e.message))}>
                <strong style={{ fontWeight: 500 }}>{p.name}</strong><span>{p.title}</span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>Staff sign-in only. Real authentication comes before any real data.</p>
        </div>
      </div>
    </main>
  );
}

const KIND = { tenant_reply: 'Tenant reply drafted', maintenance_note: 'Maintenance note drafted' };
const CHIPS = [['repairs', 'Show open repairs'], ['inbox', 'Review tenant drafts'], ['overview', 'See what needs attention'], ['inbox', 'Draft a note to maintenance']];
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const pct = (num, den) => (den ? Math.round((num / den) * 100) : null);

export function Campus({ user, can }) {
  const s01 = useLoad(() => list('signals', { signal_id: 'S01' }), [user.id]);
  const s04 = useLoad(() => list('signals', { signal_id: 'S04' }), [user.id]);
  const s02 = useLoad(() => list('signals', { signal_id: 'S02' }), [user.id]);
  const pend = useLoad(() => (can('inbox') ? list('approvals', { status: 'pending' }) : Promise.resolve(null)), [user.id]);
  const done = useLoad(() => (can('inbox') ? list('approvals', { status: 'approved' }) : Promise.resolve(null)), [user.id]);
  const first = String(user.name || '').split(' ')[0];
  const rows = (st) => (st.data ? st.data.rows : []);
  const cnt = (st, bands) => (st.data ? rows(st).filter((r) => bands.includes(r.band)).length : '–');
  const tot = (st) => (st.data ? rows(st).length : '–');
  const pendingRows = rows(pend);
  const activity = [...pendingRows.map((r) => ({ ...r, tag: 'Pending', tone: 'warn' })), ...rows(done).map((r) => ({ ...r, tag: 'Approved', tone: 'good' }))]
    .sort((x, y) => String(y.requested_at).localeCompare(String(x.requested_at))).slice(0, 5);
  const late = rows(s01).filter((r) => r.band === 'breach_presumed').slice(0, 4);
  const health = [
    ['Repairs within 7 days', s01.data ? pct(rows(s01).length - rows(s01).filter((r) => r.band === 'breach_presumed').length, rows(s01).length) : null, 'S01'],
    ['Leases not at high renewal risk', s04.data ? pct(rows(s04).length - rows(s04).filter((r) => r.band === 'high').length, rows(s04).length) : null, 'S04'],
    ['Work orders assigned promptly', s02.data ? pct(rows(s02).length - rows(s02).filter((r) => ['high', 'elevated'].includes(r.band)).length, rows(s02).length) : null, 'S02'],
  ];
  const tiles = [
    ['Repairs past 7 days', cnt(s01, ['breach_presumed']), s01.data ? `of ${tot(s01)} tracked` : '', 'bad'],
    ['High renewal risk', cnt(s04, ['high']), s04.data ? `of ${tot(s04)} leases` : '', 'warn'],
    ['Slow assignments', cnt(s02, ['high', 'elevated']), s02.data ? `of ${tot(s02)} work orders` : '', 'bad'],
    ['Drafts waiting', can('inbox') ? (pend.data ? pendingRows.length : '–') : '–', 'for your approval', 'gold'],
  ].filter((t) => t[0] !== 'Drafts waiting' || can('inbox'));
  return (
    <>
      <div className="pagehead">
        <div><h1>{greeting()}, {first}</h1><p>Here is what is happening across your properties today.</p></div>
        <span className="demo">Demo · synthetic data</span>
      </div>
      <div className="kpirow">
        {tiles.map(([l, v, sub, tone]) => (
          <div className={`kpi ${Number(v) > 0 || tone === 'gold' ? tone : ''}`} key={l}><span>{l}</span><b>{v}</b>{sub ? <em>{sub}</em> : null}</div>
        ))}
      </div>
      <div className="ov">
        <div className="col">
          <section className="pn">
            <header><span>Recent activity</span>{can('inbox') ? <a href="#inbox">View all →</a> : null}</header>
            {can('inbox') ? (activity.length ? activity.map((r) => (
              <div className="arow" key={r.approval_id}><div><b>{KIND[r.kind] || r.kind}</b><small>Work order {r.entity_id} · {String(r.requested_at || '').slice(0, 10)}</small></div><span className={`tag ${r.tone}`}>{r.tag}</span></div>
            )) : <p className="empty">No agent activity yet.</p>) : <p className="empty">Agent drafts are handled by the property manager.</p>}
          </section>
          <section className="pn">
            <header><span>Portfolio health</span><span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>Live from the signals</span></header>
            {health.map(([label, v, sig]) => (
              <div className="hrow" key={sig}>
                <div><span>{label}</span><b>{v === null ? '–' : `${v}%`}</b></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${v || 0}%` }} /></div>
              </div>
            ))}
          </section>
        </div>
        <div className="col">
          <section className="pn">
            <header><span>Needs attention</span>{can('repairs') ? <a href="#repairs">Open repairs →</a> : null}</header>
            {late.length ? late.map((r) => (
              <div className="todo" key={r.entity_id}><span>Follow up on work order {r.entity_id}</span><time className="late">{Number.isFinite(Number(r.value)) ? `${Number(r.value).toFixed(0)} days open` : 'Past 7 days'}</time></div>
            )) : <p className="empty">No repairs are past the 7-day presumption.</p>}
          </section>
          <section className="pn asst">
            <header><span>Assistant</span></header>
            <p>Drafts only: nothing is sent until you approve.</p>
            <div className="chips">{CHIPS.filter(([page]) => can(page)).map(([page, label]) => <a key={label} className="chipbtn" href={`#${page}`}>{label}</a>)}</div>
            <input type="text" disabled aria-label="Ask the assistant (not live yet)" placeholder="Ask anything (not live yet)" />
          </section>
        </div>
      </div>
    </>
  );
}
