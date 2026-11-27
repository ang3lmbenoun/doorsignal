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
          <p className="muted" style={{ margin: 0, fontSize: 12, textAlign: 'center' }}>Demo sign-in on synthetic data. There are no passwords: choose a person. Each one sees only what their role allows, enforced by the database.</p>
          {err ? <p className="error" role="alert">{err}</p> : null}
          <div className="people">
            {(people || []).map((p) => (
              <button key={p.id} className="person" onClick={() => login(p.id).then((d) => onDone(d.user)).catch((e) => setErr(e.message))}>
                <strong style={{ fontWeight: 500 }}>{p.name}</strong><span>{p.title}</span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 11, textAlign: 'center' }}>Staff sign-in only. Real authentication comes before any real data.</p>
        </div>
      </div>
    </main>
  );
}

const CARDS = [
  ['overview', 'mgmt', 'Management'], ['leases', 'tenants', 'Tenants and leases'],
  ['repairs', 'maint', 'Maintenance'], ['inbox', 'complaints', 'Complaints and service requests'],
];
const KIND = { tenant_reply: 'Tenant reply drafted', maintenance_note: 'Maintenance note drafted' };
const CHIPS = [['repairs', 'Show open repairs'], ['inbox', 'Review tenant drafts'], ['overview', 'See what needs attention'], ['inbox', 'Draft a note to maintenance']];
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const Ic = ({ d }) => <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d6b06a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const ICON = { home: 'M3 11l9-8 9 8v10H3z', fix: 'M14 6l4 4-9 9H5v-4zM13 7l4 4', chat: 'M4 5h16v11H9l-5 4z', doc: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7', clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', star: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z' };

export function Campus({ user, can }) {
  const s01 = useLoad(() => list('signals', { signal_id: 'S01' }), [user.id]);
  const s04 = useLoad(() => list('signals', { signal_id: 'S04' }), [user.id]);
  const s02 = useLoad(() => list('signals', { signal_id: 'S02' }), [user.id]);
  const pend = useLoad(() => (can('inbox') ? list('approvals', { status: 'pending' }) : Promise.resolve(null)), [user.id]);
  const done = useLoad(() => (can('inbox') ? list('approvals', { status: 'approved' }) : Promise.resolve(null)), [user.id]);
  const wo = useLoad(() => (can('repairs') ? list('work-orders') : Promise.resolve(null)), [user.id]);
  const first = String(user.name || '').split(' ')[0];
  const cnt = (st, bands) => (st.data ? st.data.rows.filter((r) => bands.includes(r.band)).length : '–');
  const tot = (st) => (st.data ? st.data.rows.length : '–');
  const pendingRows = pend.data ? pend.data.rows : [];
  const activity = [...pendingRows.map((r) => ({ ...r, tag: 'Pending', tone: 'warn' })), ...(done.data ? done.data.rows.map((r) => ({ ...r, tag: 'Approved', tone: 'good' })) : [])]
    .sort((x, y) => String(y.requested_at).localeCompare(String(x.requested_at))).slice(0, 3);
  const late = s01.data ? s01.data.rows.filter((r) => r.band === 'breach_presumed').slice(0, 3) : [];
  const onTime = s01.data && s01.data.rows.length ? Math.round(((s01.data.rows.length - s01.data.rows.filter((r) => r.band === 'breach_presumed').length) / s01.data.rows.length) * 100) : null;
  const tiles = [
    ['home', cnt(s01, ['breach_presumed']), 'Repairs past 7 days', s01.data ? `of ${tot(s01)} tracked` : ''],
    ['doc', cnt(s04, ['high']), 'High renewal risk', s04.data ? `of ${tot(s04)} leases` : ''],
    ['fix', cnt(s02, ['high', 'elevated']), 'Slow assignments', s02.data ? `of ${tot(s02)} work orders` : ''],
    ['chat', can('inbox') ? (pend.data ? pendingRows.length : '–') : '–', 'Drafts waiting', 'for your approval'],
  ];
  return (
    <>
      <section className="hero">
        <img src="/img/hero.jpg" alt="" />
        <div className="chip"><span>Demo · synthetic data</span><span>{user.title}</span></div>
        <div className="words"><h1>{greeting()}, {first}</h1><span className="tag">Here is what is happening across your properties today.</span></div>
      </section>
      <div className="campus2">
        <div className="lcol">
          <div className="cards4">
            {CARDS.filter(([page]) => can(page)).map(([page, img, label]) => (
              <a key={page} className="pcard" href={`#${page}`} aria-label={label}><img src={`/img/card-${img}.jpg`} alt={label} /></a>
            ))}
          </div>
          <div className="rowA">
            <section className="pn">
              <header><span>Key indicators</span><span className="muted" style={{ fontSize: 11 }}>Live from the signals</span></header>
              <div className="kpis">
                {tiles.filter((t) => t[2] !== 'Drafts waiting' || can('inbox')).map(([ic, v, l, sub]) => (
                  <div className="kpi" key={l}><Ic d={ICON[ic]} /><b>{v}</b><span>{l}</span>{sub ? <em>{sub}</em> : null}</div>
                ))}
              </div>
            </section>
            <section className="pn">
              <header><span>Recent activity</span>{can('inbox') ? <a href="#inbox">View all →</a> : null}</header>
              {can('inbox') ? (activity.length ? activity.map((r) => (
                <div className="act" key={r.approval_id}><Ic d={ICON.chat} /><div><span>{KIND[r.kind] || r.kind}</span><small>Work order {r.entity_id} · {String(r.requested_at || '').slice(0, 10)}</small></div><b className={`tag ${r.tone}`}>{r.tag}</b></div>
              )) : <p className="empty">No agent activity yet.</p>) : <p className="empty">Agent drafts are handled by the property manager.</p>}
            </section>
          </div>
          <div className="rowB">
            <section className="pn">
              <header><span>Portfolio overview</span><span className="muted" style={{ fontSize: 11 }}>Demo portfolio</span></header>
              <div className="port">
                <img src="/img/thumb.jpg" alt="" />
                <div className="pname"><span>{user.org_id ? `Org ${user.org_id}` : 'All orgs'}</span><small className="muted">Synthetic data</small></div>
                <div className="pnum"><small>Leases scored</small><b>{tot(s04)}</b></div>
                <div className="pnum"><small>Open work orders</small><b>{wo.data ? wo.data.rows.filter((r) => r.is_open).length : '–'}</b></div>
                {onTime === null ? null : (
                  <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${onTime} percent of repairs within 7 days`}>
                    <circle cx="38" cy="38" r="31" fill="none" stroke="rgba(243,235,218,.12)" strokeWidth="6" />
                    <circle cx="38" cy="38" r="31" fill="none" stroke="#2fd27a" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(onTime / 100) * 194.8} 194.8`} transform="rotate(-90 38 38)" />
                    <text x="38" y="43" textAnchor="middle" fontSize="13" fill="#f3ebda">{onTime}%</text>
                  </svg>
                )}
              </div>
              {onTime === null ? null : <small className="muted">Ring: repairs within the 7-day presumption (S01).</small>}
            </section>
            <section className="pn">
              <header><span>Upcoming follow-ups</span>{can('repairs') ? <a href="#repairs">Open repairs →</a> : null}</header>
              {late.length ? late.map((r) => (
                <div className="todo" key={r.entity_id}><span><i />Follow up on work order {r.entity_id}</span><time>{Number(r.value).toFixed(0)} days open</time></div>
              )) : <p className="empty">No repairs are past the 7-day presumption.</p>}
            </section>
          </div>
        </div>
        <aside className="rcol">
          <section className="pn asst">
            <header><span className="aname"><Ic d={ICON.star} />DoorSignal assistant</span></header>
            <small className="muted">Drafts only: nothing is sent until you approve.</small>
            <p style={{ margin: '4px 0 0' }}>How can I help you today?</p>
            <div className="chips">{CHIPS.filter(([page]) => can(page)).map(([page, label]) => <a key={label} className="chipbtn" href={`#${page}`}>{label}</a>)}</div>
            <input type="text" disabled aria-label="Ask the assistant (not live yet)" placeholder="Ask anything (not live yet)" />
          </section>
          <img className="flowers" src="/img/flowers.jpg" alt="" />
        </aside>
      </div>
    </>
  );
}
