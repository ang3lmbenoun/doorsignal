import React from 'react';

export const fmtMoney = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
export const fmtNum = (v, d = 1) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
export const fmtDate = (v) => (v ? String(v).slice(0, 10) : '');
export const fmtPct = (v, d = 0) => (v === null || v === undefined || v === '' ? '' : `${(Number(v) * 100).toFixed(d)}%`);

const BAND_TONE = {
  breach_presumed: 'bad', emergency_watch: 'bad', high: 'bad', breach: 'bad', at_risk: 'warn', elevated: 'warn', medium: 'warn',
  watch: 'warn', repeat: 'warn', chronic: 'bad', slow_vs_peers: 'warn', drifting: 'warn', shifting_late: 'warn', high_risk: 'bad',
  ok: 'good', normal: 'good', low: 'good', good: 'good', stable: 'good', improving: 'good', fresh: 'good',
};
export const Band = ({ band }) => <span className={`pill ${BAND_TONE[band] || 'mute'}`}>{String(band || '').replaceAll('_', ' ')}</span>;
export const Grade = ({ grade, lineage }) => <span className="grade" title={lineage ? `Lineage: ${lineage}` : ''}>{grade}</span>;

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

// Horizontal bars from {label: count}. Plain divs, no chart library.
export function Bars({ data, tone = {} }) {
  const entries = Object.entries(data);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="bars">
      {entries.map(([label, n]) => (
        <div className="bar-row" key={label}>
          <div className="bar-label">{label.replaceAll('_', ' ')}</div>
          <div className="bar-track"><div className={`bar-fill ${tone[label] || ''}`} style={{ width: `${(n / max) * 100}%` }} /></div>
          <div className="bar-n">{n}</div>
        </div>
      ))}
    </div>
  );
}

export const countBy = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});

export function Table({ columns, rows, empty = 'No rows.', onRow }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.__key ?? i} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? 'click' : ''}>
              {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function useLoad(fn, deps) {
  const [state, setState] = React.useState({ loading: true, error: null, data: null });
  React.useEffect(() => {
    let live = true;
    setState({ loading: true, error: null, data: null });
    fn().then((data) => live && setState({ loading: false, error: null, data }))
      .catch((error) => live && setState({ loading: false, error, data: null }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function Async({ state, children }) {
  if (state.loading) return <p className="muted">Loading...</p>;
  if (state.error) {
    return <p className="error">{state.error.status === 403 ? 'Your role cannot see this.' : `Could not load: ${state.error.message}`}</p>;
  }
  return children(state.data);
}
