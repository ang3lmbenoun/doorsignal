import React from 'react';
import { decide, list } from './api.js';
import { Async, Band, Bars, Grade, Stat, Table, countBy, fmtDate, fmtMoney, fmtNum, fmtPct, useLoad } from './ui.jsx';

const BAD = { breach_presumed: 'bad', emergency_watch: 'bad', high: 'bad', at_risk: 'warn', elevated: 'warn', medium: 'warn' };

export function Overview({ user, can, go }) {
  const s01 = useLoad(() => list('signals', { signal_id: 'S01' }), []);
  const s04 = useLoad(() => list('signals', { signal_id: 'S04' }), []);
  const s02 = useLoad(() => list('signals', { signal_id: 'S02' }), []);
  const inbox = useLoad(() => (can('inbox') ? list('approvals', { status: 'pending' }) : Promise.resolve(null)), [user.id]);
  const loss = useLoad(() => (can('money') ? list('expected-loss') : Promise.resolve(null)), [user.id]);
  return (
    <>
      <h1>Overview</h1>
      <p className="muted">What needs attention today for {user.org_id ? `${user.org_id}` : 'every org'}{user.owner_id ? `, owner ${user.owner_id}` : ''}.</p>
      <div className="grid stats">
        <Async state={s01}>{(d) => {
          const n = d.rows.filter((r) => r.band === 'breach_presumed').length;
          return <Stat label="Repairs past the 7-day presumption" value={n} sub={`of ${d.rows.length} tracked`} tone={n ? 'bad' : 'good'} />;
        }}</Async>
        <Async state={s04}>{(d) => {
          const n = d.rows.filter((r) => r.band === 'high').length;
          return <Stat label="Leases at high renewal risk" value={n} sub={`of ${d.rows.length} scored`} tone={n ? 'warn' : 'good'} />;
        }}</Async>
        <Async state={s02}>{(d) => {
          const n = d.rows.filter((r) => r.band === 'high' || r.band === 'elevated').length;
          return <Stat label="Slow assignments" value={n} sub={`of ${d.rows.length} work orders`} tone={n ? 'warn' : 'good'} />;
        }}</Async>
        {can('inbox') ? <Async state={inbox}>{(d) => (
          <Stat label="Drafts waiting for you" value={d.rows.length} sub="open the inbox" tone={d.rows.length ? 'accent' : 'good'} />
        )}</Async> : null}
        {can('money') ? <Async state={loss}>{(d) => (
          <Stat label="Expected loss, open leases" value={fmtMoney(d.rows.reduce((a, r) => a + Number(r.el_total || 0), 0))} sub="non-renewal plus delinquency" />
        )}</Async> : null}
      </div>
      <div className="grid two">
        <section className="card"><h2>Repair clock (S01)</h2><Async state={s01}>{(d) => <Bars data={countBy(d.rows, 'band')} tone={BAD} />}</Async></section>
        <section className="card"><h2>Renewal risk (S04)</h2><Async state={s04}>{(d) => <Bars data={countBy(d.rows, 'band')} tone={BAD} />}</Async></section>
      </div>
      {can('inbox') ? <p><button className="btn" onClick={() => go('inbox')}>Open approval inbox</button></p> : null}
    </>
  );
}

export function Signals() {
  const [signal, setSignal] = React.useState('');
  const [band, setBand] = React.useState('');
  const state = useLoad(() => list('signals', { ...(signal ? { signal_id: signal } : {}), ...(band ? { band } : {}) }), [signal, band]);
  const ids = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S12'];
  return (
    <>
      <h1>Signals</h1>
      <div className="filters">
        <label>Signal <select value={signal} onChange={(e) => setSignal(e.target.value)}><option value="">all</option>{ids.map((i) => <option key={i}>{i}</option>)}</select></label>
        <label>Band <input value={band} placeholder="e.g. high" onChange={(e) => setBand(e.target.value.toLowerCase().replace(/[^a-z_]/g, ''))} /></label>
      </div>
      <Async state={state}>{(d) => (
        <>
          <p className="muted">{d.rows.length} rows (max 500). Grade A real data, B synthetic calibrated to a benchmark, C synthetic with an assumption. Hover a grade for its lineage.</p>
          <Table rows={d.rows} columns={[
            { key: 'signal_id', label: 'Signal' }, { key: 'entity_type', label: 'Entity' }, { key: 'entity_id', label: 'Id' },
            { key: 'value', label: 'Value', num: true, render: (r) => fmtNum(r.value, 2) },
            { key: 'band', label: 'Band', render: (r) => <Band band={r.band} /> },
            { key: 'evidence_grade', label: 'Grade', render: (r) => <Grade grade={r.evidence_grade} lineage={r.lineage_ref} /> },
            { key: 'computed_at', label: 'Computed', render: (r) => fmtDate(r.computed_at) },
          ]} />
        </>
      )}</Async>
    </>
  );
}

export function Repairs() {
  const [onlyOpen, setOnlyOpen] = React.useState(true);
  const wo = useLoad(() => list('work-orders'), []);
  const s01 = useLoad(() => list('signals', { signal_id: 'S01' }), []);
  return (
    <>
      <h1>Repair clock</h1>
      <p className="callout">S01 is a rebuttable 7.0-day presumption for the Texas repair timeline, not a legal finding. Have an attorney review the wording before using it on real tenants.</p>
      <Async state={s01}>{(d) => <Table rows={d.rows.map((r) => ({ ...r, __key: r.entity_id }))} empty="No S01 rows for your role." columns={[
        { key: 'entity_id', label: 'Work order' }, { key: 'value', label: 'Days open', num: true, render: (r) => fmtNum(r.value, 1) },
        { key: 'band', label: 'Band', render: (r) => <Band band={r.band} /> },
        { key: 'evidence_grade', label: 'Grade', render: (r) => <Grade grade={r.evidence_grade} lineage={r.lineage_ref} /> },
      ]} />}</Async>
      <h2>Work orders</h2>
      <label className="check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Open only</label>
      <Async state={wo}>{(d) => <Table rows={d.rows.filter((r) => !onlyOpen || r.is_open)} columns={[
        { key: 'work_order_id', label: 'Id' }, { key: 'category', label: 'Category' }, { key: 'severity', label: 'Severity' },
        { key: 'submitted_at', label: 'Submitted', render: (r) => fmtDate(r.submitted_at) },
        { key: 'assign_hours', label: 'Hours to assign', num: true, render: (r) => fmtNum(r.assign_hours, 0) },
        { key: 'repair_days', label: 'Repair days', num: true, render: (r) => fmtNum(r.repair_days, 1) },
        { key: 'vendor_id', label: 'Vendor' }, { key: 'status', label: 'Status' },
      ]} />}</Async>
    </>
  );
}

export function Leases() {
  const s04 = useLoad(() => list('signals', { signal_id: 'S04' }), []);
  const leases = useLoad(() => list('leases'), []);
  return (
    <>
      <h1>Leases and renewal risk</h1>
      <Async state={s04}>{(d) => <section className="card"><h2>Renewal risk by band</h2><Bars data={countBy(d.rows, 'band')} tone={BAD} /></section>}</Async>
      <h2>Leases</h2>
      <Async state={leases}>{(d) => <Table rows={d.rows} columns={[
        { key: 'lease_id', label: 'Lease' }, { key: 'unit_id', label: 'Unit' }, { key: 'zip', label: 'ZIP' },
        { key: 'monthly_rent', label: 'Rent', num: true, render: (r) => fmtMoney(r.monthly_rent) },
        { key: 'end_date', label: 'Ends', render: (r) => fmtDate(r.end_date) }, { key: 'status', label: 'Status' }, { key: 'outcome', label: 'Outcome' },
        { key: 'offered_increase_pct', label: 'Offered increase', num: true, render: (r) => fmtPct(r.offered_increase_pct, 1) },
        { key: 'early_wo_count', label: 'Early requests', num: true },
      ]} />}</Async>
    </>
  );
}

export function Money() {
  const loss = useLoad(() => list('expected-loss'), []);
  const stress = useLoad(() => list('stress'), []);
  return (
    <>
      <h1>Expected loss and stress</h1>
      <p className="muted">Expected loss is probability times dollars at stake. Probabilities come from a model fitted to synthetic data, so read the sizes as shape, not forecast.</p>
      <Async state={stress}>{(d) => <Table rows={d.rows} empty="No stress rows." columns={[
        { key: 'scenario_id', label: 'Scenario' }, { key: 'description', label: 'What changes' },
        { key: 'n_leases', label: 'Leases', num: true },
        { key: 'el_total', label: 'Expected loss', num: true, render: (r) => fmtMoney(r.el_total) },
        { key: 'delta_vs_base', label: 'Vs base', num: true, render: (r) => fmtMoney(r.delta_vs_base) },
        { key: 'pct_vs_base', label: '%', num: true, render: (r) => fmtPct(r.pct_vs_base, 1) },
        { key: 'evidence_grade', label: 'Grade', render: (r) => <Grade grade={r.evidence_grade} lineage={r.lineage_ref} /> },
      ]} />}</Async>
      <h2>Largest expected losses by lease</h2>
      <Async state={loss}>{(d) => <Table rows={[...d.rows].sort((a, b) => Number(b.el_total) - Number(a.el_total)).slice(0, 25)} columns={[
        { key: 'lease_id', label: 'Lease' }, { key: 'zip', label: 'ZIP' },
        { key: 'monthly_rent', label: 'Rent', num: true, render: (r) => fmtMoney(r.monthly_rent) },
        { key: 'p_nonrenew', label: 'P(non-renew)', num: true, render: (r) => fmtPct(r.p_nonrenew) },
        { key: 'el_nonrenewal', label: 'EL non-renewal', num: true, render: (r) => fmtMoney(r.el_nonrenewal) },
        { key: 'el_delinquency', label: 'EL delinquency', num: true, render: (r) => fmtMoney(r.el_delinquency) },
        { key: 'el_total', label: 'EL total', num: true, render: (r) => fmtMoney(r.el_total) },
      ]} />}</Async>
    </>
  );
}

export function Risk() {
  const state = useLoad(() => list('risk-register'), []);
  return (
    <>
      <h1>Risk register</h1>
      <p className="muted">Likelihood and impact (1 to 5) are judgment inputs, not measurements. Each risk links to the signals that would show it.</p>
      <Async state={state}>{(d) => <Table rows={d.rows} empty="No risks are assigned to your role." columns={[
        { key: 'risk_id', label: 'Id' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Risk' },
        { key: 'likelihood', label: 'L', num: true }, { key: 'impact', label: 'I', num: true }, { key: 'score', label: 'Score', num: true },
        { key: 'band', label: 'Band', render: (r) => <Band band={r.band} /> }, { key: 'owner_role', label: 'Owner' },
        { key: 'review_date', label: 'Review', render: (r) => fmtDate(r.review_date) },
      ]} />}</Async>
    </>
  );
}

const KIND = {
  tenant_status_message: 'Tenant status message', vendor_reassignment_suggestion: 'Vendor reassignment suggestion',
};

export function Inbox({ user }) {
  const [status, setStatus] = React.useState('pending');
  const [tick, setTick] = React.useState(0);
  const [sel, setSel] = React.useState(null);
  const state = useLoad(() => list('approvals', { status }), [status, tick, user.id]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  async function act(item, verdict) {
    setBusy(true); setMsg(null);
    try {
      await decide(item.approval_id, verdict);
      setMsg({ ok: true, text: verdict === 'approve' ? 'Approved. Nothing was sent: approval is a recorded decision.' : 'Rejected.' });
      setSel(null); setTick((t) => t + 1);
    } catch (e) {
      setMsg({ ok: false, text: e.status === 409 ? 'Someone already decided this one.' : e.status === 403 ? 'Your role cannot decide approvals.' : `Failed: ${e.message}` });
      setTick((t) => t + 1);
    } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Approval inbox</h1>
      <p className="callout">The agent only drafts. Approving records your decision and the exact text you saw. It does not send anything to a tenant or a vendor.</p>
      <div className="tabs">
        {['pending', 'approved', 'rejected'].map((s) => <button key={s} className={`tab ${s === status ? 'on' : ''}`} onClick={() => { setStatus(s); setSel(null); setMsg(null); }}>{s}</button>)}
      </div>
      {msg ? <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p> : null}
      <Async state={state}>{(d) => (
        <div className="split">
          <div>
            <Table rows={d.rows.map((r) => ({ ...r, __key: r.approval_id }))} empty={`Nothing ${status}.`} onRow={setSel} columns={[
              { key: 'kind', label: 'Draft', render: (r) => KIND[r.kind] || r.kind },
              { key: 'entity_id', label: 'Work order' },
              { key: 'mode', label: 'Made by', render: (r) => (r.mode === 'llm' ? `model (${r.model})` : 'rules') },
              { key: 'requested_at', label: 'Requested', render: (r) => fmtDate(r.requested_at) },
            ]} />
          </div>
          <div>{sel ? <Detail item={sel} busy={busy} act={act} /> : <p className="muted">Pick a draft to read it.</p>}</div>
        </div>
      )}</Async>
    </>
  );
}

function Detail({ item, busy, act }) {
  const pending = item.status === 'pending';
  const text = pending ? item.draft_text : item.draft_text_at_decision;
  return (
    <section className="card detail">
      <h2>{KIND[item.kind] || item.kind}</h2>
      <p className="muted">Work order {item.entity_id} · tier {item.tier} · <Grade grade={item.evidence_grade} lineage={item.lineage_ref} /> synthetic agent output · run {String(item.run_id).slice(0, 8)}</p>
      <blockquote>{text}</blockquote>
      {pending ? (
        <div className="actions">
          <button className="btn good" disabled={busy} onClick={() => act(item, 'approve')}>Approve</button>
          <button className="btn bad" disabled={busy} onClick={() => act(item, 'reject')}>Reject</button>
        </div>
      ) : (
        <p className="muted">{item.status} by {item.decided_by} ({String(item.decided_role).replaceAll('_', ' ')}) on {fmtDate(item.decided_at)}. SHA-256 of the text decided: <code>{String(item.draft_sha256).slice(0, 16)}…</code></p>
      )}
      {item.payload && Object.keys(item.payload).length ? (
        <details><summary>Why the agent drafted this</summary>
          <dl>{Object.entries(item.payload).filter(([, v]) => typeof v !== 'object').map(([k, v]) => <React.Fragment key={k}><dt>{k.replaceAll('_', ' ')}</dt><dd>{String(v)}</dd></React.Fragment>)}</dl>
        </details>
      ) : null}
    </section>
  );
}
