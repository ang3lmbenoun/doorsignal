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
const KIND = { tenant_reply: 'Tenant reply draft', maintenance_note: 'Maintenance note draft' };

export function Campus({ user, can, go }) {
  const s01 = useLoad(() => list('signals', { signal_id: 'S01' }), [user.id]);
  const s04 = useLoad(() => list('signals', { signal_id: 'S04' }), [user.id]);
  const s02 = useLoad(() => list('signals', { signal_id: 'S02' }), [user.id]);
  const inbox = useLoad(() => (can('inbox') ? list('approvals', { status: 'pending' }) : Promise.resolve(null)), [user.id]);
  const wo = useLoad(() => (can('repairs') ? list('work-orders') : Promise.resolve(null)), [user.id]);
  const first = String(user.name || '').split(' ')[0];
  const n = (state, band) => (state.data ? state.data.rows.filter((r) => band.includes(r.band)).length : '–');
  const pending = inbox.data ? inbox.data.rows : [];
  return (
    <>
      <section className="hero">
        <img src="/img/hero.jpg" alt="" />
        <div className="chip"><span>Demo · synthetic data</span><span>{user.title}</span></div>
        <div className="words">
          <h1>Welcome Back, {first}</h1>
          <span className="tag">Smarter Operations. Happier Residents. Stronger Communities.</span>
          <span className="rule" />
        </div>
      </section>
      <div className="campus">
        <div className="cards">
          {CARDS.filter(([page]) => can(page)).map(([page, img, label]) => (
            <a key={page} className="pcard" href={`#${page}`} aria-label={label}><img src={`/img/card-${img}.jpg`} alt={label} /></a>
          ))}
        </div>
        <div className="row3">
          <section className="pn">
            <header><span>Key indicators</span><span className="muted" style={{ fontSize: 11 }}>Live from the signals</span></header>
            <div className="kpis">
              <div className="kpi"><b>{n(s01, ['breach_presumed'])}</b><span>Repairs past 7 days</span><em className="muted">{s01.data ? `of ${s01.data.rows.length} tracked` : ''}</em></div>
              <div className="kpi"><b>{n(s04, ['high'])}</b><span>Leases at high renewal risk</span><em className="muted">{s04.data ? `of ${s04.data.rows.length} scored` : ''}</em></div>
              <div className="kpi"><b>{n(s02, ['high', 'elevated'])}</b><span>Slow assignments</span><em className="muted">{s02.data ? `of ${s02.data.rows.length} work orders` : ''}</em></div>
              {can('inbox') ? <div className="kpi"><b>{inbox.data ? pending.length : '–'}</b><span>Drafts waiting</span><em className="muted">for your approval</em></div> : null}
            </div>
          </section>
          <section className="pn">
            <header><span>Pending action</span>{can('inbox') ? <a href="#inbox">View all →</a> : null}</header>
            {can('inbox') ? (
              <Async state={inbox}>{(d) => (d.rows.length ? d.rows.slice(0, 5).map((r) => (
                <div className="pend" key={r.approval_id}><span><i style={{ background: '#e8a33d' }} />{KIND[r.kind] || r.kind}, work order {r.entity_id}</span><time>{String(r.requested_at || '').slice(0, 10)}</time></div>
              )) : <p className="empty">Nothing waiting for you.</p>)}</Async>
            ) : <p className="empty">Approvals are handled by the property manager.</p>}
          </section>
          <section className="pn assist">
            <img src="/img/assistant.jpg" alt="" />
            <div className="say">
              <header style={{ marginBottom: 10 }}><span>DoorSignal assistant</span></header>
              <div className="bubble">{can('inbox') ? (inbox.data ? (pending.length ? `${pending.length} draft${pending.length === 1 ? '' : 's'} are ready for your review. I only draft: nothing is sent until you approve.` : 'No drafts are waiting. I will flag the next one here.') : 'Checking for drafts…') : 'Drafts are reviewed by the property manager.'}</div>
              {can('inbox') ? <p style={{ margin: '12px 0 0' }}><a className="btn" href="#inbox">Review requests →</a></p> : null}
            </div>
          </section>
        </div>
        <div className="row2">
          <section className="pn">
            <header><span>Portfolio at a glance</span></header>
            <div className="kpis">
              <div className="kpi"><b>{s04.data ? s04.data.rows.length : '–'}</b><span>Leases scored</span></div>
              <div className="kpi"><b>{wo.data ? wo.data.rows.filter((r) => r.is_open).length : '–'}</b><span>Open work orders</span></div>
              <div className="kpi"><b>{s01.data ? s01.data.rows.length : '–'}</b><span>Repairs on the clock</span></div>
            </div>
          </section>
          <section className="pn">
            <header><span>Where to look next</span></header>
            {can('risk') ? <p className="empty" style={{ margin: 0 }}>The risk register ranks what to fix first. <a href="#risk" onClick={() => go('risk')}>Open it →</a></p> : <p className="empty" style={{ margin: 0 }}>Your role sees the signals that apply to it.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
