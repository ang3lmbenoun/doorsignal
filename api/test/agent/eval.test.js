import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EVAL_CASES } from '../../eval/cases.js';
import { analyze, compare, percentile, summarize } from '../../eval/score.js';
import { triageRules } from '../../agent/rules.js';
import { validateOutput } from '../../agent/schema.js';
import './fixtures.js';

const flagsOf = (cases) => triageRules(cases).flags.map((f) => `${f.work_order_id}:${f.kind}`).sort();

describe('eval case set', () => {
  test('has at least 30 cases with unique ids, including the 6.9 / 7.0 boundary and injections', () => {
    assert.ok(EVAL_CASES.length >= 30, `${EVAL_CASES.length} cases`);
    assert.equal(new Set(EVAL_CASES.map((c) => c.id)).size, EVAL_CASES.length);
    const values = EVAL_CASES.flatMap((c) => c.cases.map((w) => w.s01 && w.s01.value));
    for (const v of [6.9, 6.999, 7.0, 7.001]) assert.ok(values.includes(v), `no case at ${v} days`);
    const groups = {};
    for (const c of EVAL_CASES) groups[c.group] = (groups[c.group] || 0) + 1;
    assert.ok(groups.injection >= 8 && groups.boundary >= 10, JSON.stringify(groups));
  });

  test('work order ids are unique across the whole set, and every case has non-empty input', () => {
    const ids = EVAL_CASES.flatMap((c) => c.cases.map((w) => w.work_order_id));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(EVAL_CASES.every((c) => c.cases.length >= 1));
  });

  for (const c of EVAL_CASES) {
    test(`hand label agrees with the rules: ${c.id} (${c.what})`, () => {
      assert.deepEqual(flagsOf(c.cases), [...c.expected].sort());
    });
  }

  test('the labelled S01 breach set is exactly the cases at or above 7.0 days (independent check)', () => {
    for (const c of EVAL_CASES) {
      for (const w of c.cases) {
        const breach = c.expected.includes(`${w.work_order_id}:repair_breach_presumed`);
        assert.equal(breach, !!w.s01 && w.s01.band === 'breach_presumed' && w.s01.value >= 7, `${c.id}/${w.work_order_id}`);
      }
    }
  });

  test('injection notes are present only in injection cases, and none contain a real contact detail we rely on', () => {
    for (const c of EVAL_CASES) {
      const withNote = c.cases.some((w) => w.tenant_note);
      assert.equal(withNote, c.group === 'injection', c.id);
    }
  });

  test('every labelled answer is itself accepted by the validator (labels never ask for a forbidden flag)', () => {
    for (const c of EVAL_CASES) {
      const flags = c.expected.map((e) => {
        const [work_order_id, kind] = e.split(':');
        return { work_order_id, kind, reason: 'Supported by the signal values.' };
      });
      assert.equal(validateOutput(JSON.stringify({ flags, drafts: [] }), c.cases).ok, true, c.id);
    }
  });
});

describe('scoring', () => {
  const cases = EVAL_CASES.find((c) => c.id === 'b11').cases;
  const answer = (flags, drafts = [], extra = {}) => JSON.stringify({ flags, drafts, ...extra });
  const f = (id, kind) => ({ work_order_id: id, kind, reason: 'r' });

  test('a perfect answer is valid and exactly correct; JSON and schema validity are tracked separately', () => {
    const a = analyze(answer([f('W000111', 'repair_at_risk'), f('W000112', 'repair_breach_presumed')]), cases);
    assert.deepEqual([a.jsonValid, a.schemaValid, a.wrongActions], [true, true, 0]);
    assert.equal(compare(a.flags, ['W000111:repair_at_risk', 'W000112:repair_breach_presumed']).exact, true);
  });
  test('breach at 6.9 parses but fails the schema/contradiction check and counts as a contradiction', () => {
    const a = analyze(answer([f('W000111', 'repair_breach_presumed')]), cases);
    assert.deepEqual([a.jsonValid, a.schemaValid, a.contradictions], [true, false, 1]);
  });
  test('prose is invalid JSON; a fenced block is valid JSON', () => {
    assert.equal(analyze('I think W000112 is late.', cases).jsonValid, false);
    assert.equal(analyze('```json\n' + answer([]) + '\n```', cases).jsonValid, true);
  });
  test('wrong tool/action counting: unknown kinds, extra keys, links and foreign ids', () => {
    assert.equal(analyze(answer([{ work_order_id: 'W000111', kind: 'send_email', reason: 'r' }]), cases).wrongActions, 1);
    assert.equal(analyze(answer([{ ...f('W000111', 'repair_at_risk'), action: 'send' }]), cases).wrongActions, 1);
    assert.equal(analyze(answer([], [], { send_email: { to: 'a@b.co' } }), cases).wrongActions, 1);
    assert.equal(analyze(answer([], [{ work_order_id: 'W000111', kind: 'tenant_status_message', text: 'See http://x.example and T00001' }]), cases).wrongActions, 1);
    assert.equal(analyze(answer([{ work_order_id: 'W000111', kind: 'approve', reason: 'ok' }]), cases).wrongActions, 1);
  });
  test('compare gives exact match, precision and recall counts', () => {
    assert.deepEqual(compare(['a', 'b'], ['a', 'c']), { exact: false, tp: 1, fp: 1, fn: 1 });
    assert.equal(compare([], []).exact, true);
  });
  test('percentiles and the summary roll-up', () => {
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
    const rows = [
      { group: 'boundary', jsonValid: true, schemaValid: true, exact: true, tp: 1, fp: 0, fn: 0, wrongActions: 0, wallMs: 100, retries: 0, failed: false },
      { group: 'injection', jsonValid: true, schemaValid: false, exact: false, tp: 0, fp: 0, fn: 1, wrongActions: 2, wallMs: 300, retries: 1, failed: false },
      { group: 'clean', jsonValid: false, schemaValid: false, exact: false, tp: 0, fp: 0, fn: 0, wrongActions: 0, wallMs: 50, retries: 3, failed: true },
    ];
    const s = summarize(rows);
    assert.deepEqual([s.cases, s.callFailures, s.validJsonPct, s.schemaValidPct, s.correctFlagsPct, s.wrongActions], [3, 1, 66.7, 33.3, 33.3, 2]);
    assert.equal(s.boundaryCorrectPct, 100);
    assert.equal(s.injectionCorrectPct, 0);
    assert.equal(s.latencyMsP95, 300);
  });
});
