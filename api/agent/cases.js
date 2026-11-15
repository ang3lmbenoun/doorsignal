// Builds the agent's input from the read API (tier T0). Which rows come back is decided by Postgres for the
// agent's token (org-scoped maintenance_coordinator): the agent cannot see another org's work orders.
export const MAX_CASES = 60;

const SOURCES = [
  { key: 's01', signal: 'S01', bands: ['breach_presumed', 'at_risk', 'emergency_watch'] },
  { key: 's02', signal: 'S02', bands: ['high', 'elevated'] },
  { key: 's09', signal: 'S09', bands: ['chronic', 'repeat'] },
];

// Higher = look at first. Used only to cap the batch when many work orders are flagged.
function priority(c) {
  let p = 0;
  if (c.s01) p += c.s01.band === 'breach_presumed' ? 1000 + c.s01.value : c.s01.band === 'at_risk' ? 800 + c.s01.value : 600;
  if (c.s02) p += c.s02.band === 'high' ? 40 : 20;
  if (c.s09) p += c.s09.band === 'chronic' ? 30 : 10;
  return p;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// onStats({candidates, kept, truncated}) lets the caller log how many flagged work orders there were and
// whether the cap dropped any, so "no cases" and "cut short" are visible instead of silent.
export async function loadCases(client, { maxCases = MAX_CASES, onStats } = {}) {
  const byId = new Map();
  for (const { key, signal, bands } of SOURCES) {
    for (const band of bands) {
      const rows = await client.getAll('/v1/signals', { signal_id: signal, band });
      for (const r of rows) {
        if (r.entity_type !== 'work_order') continue;
        const c = byId.get(r.entity_id) || { work_order_id: r.entity_id, s01: null, s02: null, s09: null };
        c[key] = { value: Number(r.value), band: r.band };
        byId.set(r.entity_id, c);
      }
    }
  }
  const ranked = [...byId.values()].sort((a, b) => priority(b) - priority(a) || a.work_order_id.localeCompare(b.work_order_id));
  const candidates = ranked.slice(0, maxCases);
  const details = await mapLimit(candidates, 5, async (c) => {
    const body = await client.get(`/v1/work-orders/${encodeURIComponent(c.work_order_id)}`);
    return body.rows[0];
  });
  const cases = [];
  candidates.forEach((c, i) => {
    const w = details[i];
    // Actionable only while the request is open (S01 rows are open by construction).
    if (!w || !(c.s01 || w.is_open)) return;
    cases.push({
      work_order_id: c.work_order_id,
      unit_id: w.unit_id,
      vendor_id: w.vendor_id ?? null,
      category: w.category,
      severity: w.severity,
      s01: c.s01,
      s02: c.s02,
      s09: c.s09,
    });
  });
  if (onStats) onStats({ candidates: ranked.length, kept: cases.length, truncated: ranked.length > maxCases });
  return cases;
}
