import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DISCLAIMER, extractJson, finalizeDraftText, scanText, validateOutput } from '../../agent/schema.js';
import { json, mk, s01 } from './fixtures.js';

const W = (id, v, extra = {}) => mk(id, { s01: s01(v), ...extra });
const flag = (id, kind, reason = 'ok') => ({ work_order_id: id, kind, reason });
const draft = (id, kind, text = 'Short factual update.') => ({ work_order_id: id, kind, text });
const code = (text, cases) => {
  const r = validateOutput(text, cases);
  assert.equal(r.ok, false, 'expected rejection');
  return r.code;
};

describe('valid output', () => {
  const cases = [W('W000001', 7.0), W('W000002', 6.0)];
  test('accepts the exact contract and keeps only the contract fields', () => {
    const r = validateOutput(json([flag('W000001', 'repair_breach_presumed', 'Seven days reached.'), flag('W000002', 'repair_at_risk')],
      [draft('W000001', 'tenant_status_message')]), cases);
    assert.equal(r.ok, true);
    assert.equal(r.value.flags.length, 2);
    assert.deepEqual(Object.keys(r.value.drafts[0]).sort(), ['kind', 'text', 'work_order_id']);
  });
  test('accepts a single fenced JSON block, nothing else', () => {
    assert.equal(validateOutput('```json\n' + json() + '\n```', cases).ok, true);
    assert.equal(code('Here you go:\n```json\n' + json() + '\n```', cases), 'not_json');
    assert.equal(code(json() + '\nThanks!', cases), 'not_json');
  });
  test('empty answer is valid; repeated flags are kept once', () => {
    assert.equal(validateOutput(json(), cases).ok, true);
    const r = validateOutput(json([flag('W000001', 'repair_breach_presumed'), flag('W000001', 'repair_breach_presumed')]), cases);
    assert.equal(r.value.flags.length, 1);
  });
});

describe('structure is closed', () => {
  const cases = [W('W000001', 8)];
  for (const [name, text, want] of [
    ['not JSON', 'I cannot help', 'not_json'],
    ['array at top level', '[]', 'not_json'],
    ['extra top-level key', '{"flags":[],"drafts":[],"action":"send"}', 'extra_or_missing_key'],
    ['__proto__ key', '{"flags":[],"drafts":[],"__proto__":{"x":1}}', 'extra_or_missing_key'],
    ['missing drafts', '{"flags":[]}', 'extra_or_missing_key'],
    ['flags not an array', '{"flags":{},"drafts":[]}', 'not_array'],
    ['flag with extra key', json([{ ...flag('W000001', 'repair_breach_presumed'), approve: true }]), 'bad_flag_item'],
    ['flag missing reason', json([{ work_order_id: 'W000001', kind: 'repair_breach_presumed' }]), 'bad_flag_item'],
    ['draft with extra key', json([], [{ ...draft('W000001', 'tenant_status_message'), to: 'x' }]), 'bad_draft_item'],
    ['unknown flag kind (send_email)', json([flag('W000001', 'send_email')]), 'unknown_flag_kind'],
    ['unknown flag kind (approve)', json([flag('W000001', 'approve')]), 'unknown_flag_kind'],
    ['unknown draft kind (send_email)', json([], [draft('W000001', 'send_email')]), 'unknown_draft_kind'],
    ['draft kind used as a flag', json([flag('W000001', 'tenant_status_message')]), 'unknown_flag_kind'],
    ['unknown work order', json([flag('W999999', 'repair_breach_presumed')]), 'unknown_work_order'],
    ['work order not a string', json([{ work_order_id: 1, kind: 'repair_breach_presumed', reason: 'x' }]), 'unknown_work_order'],
    ['empty reason', json([flag('W000001', 'repair_breach_presumed', '')]), 'bad_reason'],
    ['reason too long', json([flag('W000001', 'repair_breach_presumed', 'x'.repeat(201))]), 'bad_reason'],
    ['draft too long', json([], [draft('W000001', 'tenant_status_message', 'x'.repeat(1201))]), 'bad_text'],
    ['empty draft', json([], [draft('W000001', 'tenant_status_message', '   ')]), 'bad_text'],
  ]) {
    test(`rejects: ${name}`, () => assert.equal(code(text, cases), want));
  }
});

describe('content the agent may never produce', () => {
  const cases = [W('W000001', 8, { unit: 'U0001', vendor: 'V01' })];
  const ids = new Set(['W000001', 'U0001', 'V01']);
  for (const [name, text, want] of [
    ['a link', 'See https://evil.example/x for details', 'forbidden:url'],
    ['a bare domain', 'Reply at tenants-portal.com today', 'forbidden:url'],
    ['an email address', 'Please write to someone@example.org', 'forbidden:email'],
    ['a phone number', 'Call 555-123-4567 now', 'forbidden:phone'],
    ['a long digit run', 'Account 12345678901', 'forbidden:phone'],
    ['a tenant id', 'This concerns tenant T00001', 'forbidden:foreign_id'],
    ['a lease id', 'See lease L00001', 'forbidden:foreign_id'],
    ['another work order', 'Also see W000777', 'forbidden:foreign_id'],
    ['another unit', 'Also unit U0999', 'forbidden:foreign_id'],
    ['an org name', 'Compare with ORG2', 'forbidden:foreign_id'],
    ['an owner id', 'Owner O06 asked', 'forbidden:foreign_id'],
    ['zero-width characters', 'Hello​ world', 'hidden_chars'],
    ['bidi override', 'Hello ‮ world', 'hidden_chars'],
    ['control characters', 'Hello\u0007 world', 'hidden_chars'],
  ]) {
    test(`scanText rejects ${name}`, () => assert.equal(scanText(text, ids), want));
    test(`validateOutput rejects ${name} in a draft and in a reason`, () => {
      assert.match(code(json([], [draft('W000001', 'tenant_status_message', text)]), cases), new RegExp(`draft:${want.replace(':', ':')}|draft:${want}`));
      assert.match(code(json([flag('W000001', 'repair_breach_presumed', text)]), cases), /^reason:/);
    });
  }
  for (const phrase of [
    'This is a violation of the law', 'The landlord is liable', 'You are entitled to a refund', 'This is illegal',
    'You may withhold rent', 'repair and deduct is available', 'You could sue', 'File a lawsuit', 'unlawful delay',
    'Texas Property Code 92.056 applies', 'terminate your lease', 'constructive eviction', 'breach of the lease',
    'speak to an attorney', 'penalties apply', 'the unit is not habitable',
  ]) {
    test(`legal conclusion is rejected: "${phrase}"`, () => {
      assert.equal(scanText(phrase, ids), 'forbidden:legal');
    });
  }
  test('ids that were in the input are fine', () => assert.equal(scanText('Update for W000001 in unit U0001 with vendor V01.', ids), null));
  test('plain dates are fine', () => assert.equal(scanText('Requested on 2026-11-13.', ids), null));
});

describe('flags must agree with the signal values they were given (S01: breach at 7.0, not before)', () => {
  const at = (v, kind) => validateOutput(json([flag('W000001', kind)]), [W('W000001', v)]);
  for (const [v, kind, ok] of [
    [6.0, 'repair_breach_presumed', false], [6.9, 'repair_breach_presumed', false], [6.999, 'repair_breach_presumed', false],
    [7.0, 'repair_breach_presumed', true], [7.001, 'repair_breach_presumed', true], [27.2, 'repair_breach_presumed', true],
    [4.99, 'repair_at_risk', false], [5.0, 'repair_at_risk', true], [6.9, 'repair_at_risk', true], [6.999, 'repair_at_risk', true],
    [7.0, 'repair_at_risk', false],
  ]) {
    test(`S01 value ${v}: ${kind} is ${ok ? 'accepted' : 'rejected'}`, () => {
      const r = at(v, kind);
      assert.equal(r.ok, ok);
      if (!ok) assert.match(r.code, /^contradicts_inputs:flag:/);
    });
  }
  test('emergency_watch needs the emergency_watch band', () => {
    assert.equal(validateOutput(json([flag('W000001', 'emergency_watch')]), [mk('W000001', { s01: s01(1.5, 'emergency_watch') })]).ok, true);
    assert.equal(validateOutput(json([flag('W000001', 'emergency_watch')]), [mk('W000001', { s01: s01(1.5, 'ok') })]).ok, false);
  });
  test('slow_assignment needs S02 elevated or high; repeat_issue needs S09', () => {
    const c = (s02, s09) => [mk('W000001', { s02, s09 })];
    assert.equal(validateOutput(json([flag('W000001', 'slow_assignment')]), c({ value: 2.1, band: 'high' }, null)).ok, true);
    assert.equal(validateOutput(json([flag('W000001', 'slow_assignment')]), c({ value: 0.2, band: 'normal' }, null)).ok, false);
    assert.equal(validateOutput(json([flag('W000001', 'slow_assignment')]), c(null, null)).ok, false);
    assert.equal(validateOutput(json([flag('W000001', 'repeat_issue')]), c(null, { value: 1, band: 'repeat' })).ok, true);
    assert.equal(validateOutput(json([flag('W000001', 'repeat_issue')]), c(null, null)).ok, false);
  });
  test('drafts are limited to the work orders the rules allow', () => {
    const none = [mk('W000001', { s01: s01(1.0) })];
    assert.match(code(json([], [draft('W000001', 'tenant_status_message')]), none), /^contradicts_inputs:draft:/);
    assert.match(code(json([], [draft('W000001', 'vendor_reassignment_suggestion')]), none), /^contradicts_inputs:draft:/);
    const ok = [mk('W000001', { s01: s01(8), s02: { value: 2.5, band: 'high' } })];
    assert.equal(validateOutput(json([], [draft('W000001', 'tenant_status_message'), draft('W000001', 'vendor_reassignment_suggestion')]), ok).ok, true);
    const noVendor = [mk('W000001', { vendor: null, s02: { value: 2.5, band: 'high' } })];
    assert.match(code(json([], [draft('W000001', 'vendor_reassignment_suggestion')]), noVendor), /^contradicts_inputs:draft:/);
  });
});

describe('disclaimer', () => {
  test('is appended in code to drafts about a work order with an S01 reading, and to no other', () => {
    const withS01 = finalizeDraftText('Update.', W('W000001', 7.5));
    assert.ok(withS01.endsWith(DISCLAIMER));
    assert.match(DISCLAIMER, /rebuttable presumption, not a legal finding/);
    assert.equal(finalizeDraftText('Update.', mk('W000002', { s02: { value: 2, band: 'high' } })), 'Update.');
    assert.ok(withS01.length <= 2000);
  });
  test('extractJson only unwraps a whole-message fenced block', () => {
    assert.equal(extractJson('{"a":1}'), '{"a":1}');
    assert.equal(extractJson('```\n{"a":1}\n```'), '{"a":1}');
    assert.equal(extractJson('x {"a":1}'), null);
    assert.equal(extractJson(null), null);
  });
});
