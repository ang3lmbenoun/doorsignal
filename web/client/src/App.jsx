import React from 'react';
import { ACCESS, getMe, logout } from './api.js';
import { Campus, Logo, SignIn } from './campus.jsx';
import { Inbox, Leases, Money, Overview, Repairs, Risk, Signals } from './pages.jsx';

const ICON = {
  campus: 'M3 11l9-8 9 8v10H3z', overview: 'M4 20V10M10 20V4M16 20v-8M22 20H2', leases: 'M16 19v-1a4 4 0 0 0-8 0v1M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  repairs: 'M14 6l4 4-9 9H5v-4zM13 7l4 4', inbox: 'M4 5h16v11H9l-5 4z', signals: 'M4 20h16M7 16v-5M12 16V6M17 16v-8',
  money: 'M12 3v18M16 7c-1-1-2-1.5-4-1.5S8 6.5 8 8.5 10 11 12 11.5s4 1 4 3-2 3-4 3-3-.5-4-1.5', risk: 'M12 3l9 16H3zM12 10v4M12 17v.5',
};
const NAV = [
  ['campus', 'Overview'], ['overview', 'Management'], ['leases', 'Tenants'], ['repairs', 'Maintenance'],
  ['inbox', 'Complaints'], ['signals', 'Analytics'], ['money', 'Expected loss'], ['risk', 'Risk register'],
];

export default function App() {
  const [user, setUser] = React.useState(undefined);
  const [page, setPage] = React.useState(() => (window.location.hash || '#campus').slice(1));
  React.useEffect(() => { getMe().then((d) => setUser(d.user)).catch(() => setUser(null)); }, []);
  React.useEffect(() => {
    const h = () => setPage((window.location.hash || '#campus').slice(1));
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  if (user === undefined) return <p className="muted pad">Loading...</p>;
  if (!user) return <SignIn onDone={(u) => { window.location.hash = '#campus'; setUser(u); }} />;

  const allowed = ACCESS[user.role] || [];
  const can = (p) => p === 'campus' || allowed.includes(p);
  const go = (p) => { window.location.hash = `#${p}`; };
  const current = can(page) ? page : 'campus';
  const View = { campus: Campus, overview: Overview, inbox: Inbox, repairs: Repairs, leases: Leases, money: Money, risk: Risk, signals: Signals }[current];

  return (
    <div className="shell">
      <aside>
        <div className="brand"><Logo size={44} /><b>DoorSignal</b><small>Connect · Manage · Thrive</small></div>
        <nav>{NAV.filter(([id]) => can(id)).map(([id, label]) => <a key={id} href={`#${id}`} className={id === current ? 'on' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[id]} /></svg>{label}</a>)}</nav>
        <div className="who">
          <img src="/img/avatar.jpg" alt="" />
          <div className="wtext"><strong>{user.name}</strong><span>{user.title}</span></div>
          <button className="link" onClick={() => logout().then(() => { setUser(null); window.location.hash = ''; })}>Sign out</button>
        </div>
      </aside>
      <main key={`${user.id}-${current}`} className={current === 'campus' ? 'bleed' : ''}>
        {current === 'campus' ? null : <div className="banner">Demo: synthetic data only</div>}
        <View user={user} can={can} go={go} />
      </main>
    </div>
  );
}
