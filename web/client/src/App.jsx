import React from 'react';
import { ACCESS, getMe, getPersonas, login, logout } from './api.js';
import { Inbox, Leases, Money, Overview, Repairs, Risk, Signals } from './pages.jsx';

const NAV = [
  ['overview', 'Overview'], ['inbox', 'Approval inbox'], ['repairs', 'Repair clock'], ['leases', 'Leases'],
  ['money', 'Expected loss'], ['risk', 'Risk register'], ['signals', 'All signals'],
];

function SignIn({ onDone }) {
  const [people, setPeople] = React.useState(null);
  const [err, setErr] = React.useState(null);
  React.useEffect(() => { getPersonas().then((d) => setPeople(d.personas)).catch((e) => setErr(e.message)); }, []);
  return (
    <main className="signin">
      <h1>DoorSignal</h1>
      <p className="muted">Signals, risk and agent drafts for small property managers.</p>
      <div className="callout">Demo sign-in with synthetic people and synthetic data. There are no passwords. Each person sees only what their role allows, enforced by the database.</div>
      {err ? <p className="error">{err}</p> : null}
      <div className="people">
        {(people || []).map((p) => (
          <button key={p.id} className="person" onClick={() => login(p.id).then((d) => onDone(d.user)).catch((e) => setErr(e.message))}>
            <strong>{p.name}</strong><span>{p.title}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

export default function App() {
  const [user, setUser] = React.useState(undefined);
  const [page, setPage] = React.useState(() => (window.location.hash || '#overview').slice(1));
  React.useEffect(() => { getMe().then((d) => setUser(d.user)).catch(() => setUser(null)); }, []);
  React.useEffect(() => {
    const h = () => setPage((window.location.hash || '#overview').slice(1));
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  if (user === undefined) return <p className="muted pad">Loading...</p>;
  if (!user) return <SignIn onDone={(u) => { window.location.hash = '#overview'; setUser(u); }} />;

  const allowed = ACCESS[user.role] || [];
  const can = (p) => allowed.includes(p);
  const go = (p) => { window.location.hash = `#${p}`; };
  const current = can(page) ? page : 'overview';
  const View = { overview: Overview, inbox: Inbox, repairs: Repairs, leases: Leases, money: Money, risk: Risk, signals: Signals }[current];

  return (
    <div className="shell">
      <aside>
        <div className="brand">DoorSignal</div>
        <nav>{NAV.filter(([id]) => can(id)).map(([id, label]) => <a key={id} href={`#${id}`} className={id === current ? 'on' : ''}>{label}</a>)}</nav>
        <div className="who">
          <strong>{user.name}</strong>
          <span>{user.title}</span>
          <button className="link" onClick={() => logout().then(() => { setUser(null); window.location.hash = ''; })}>Sign out</button>
        </div>
      </aside>
      <main key={`${user.id}-${current}`}>
        <div className="banner">Demo: synthetic data only</div>
        <View user={user} can={can} go={go} />
      </main>
    </div>
  );
}
