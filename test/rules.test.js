import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, buildFiling } from '../server/rules.js';
import { SEED_EVIDENCE } from '../server/paypal/mock.js';

const mk = (id, o) => ({ id, currency: 'USD', ...SEED_EVIDENCE[id], ...o });
const ceramics = mk('PP-D-DEMO-1001', { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', stage: 'CHARGEBACK', amount: 186 });
const jacket = mk('PP-D-DEMO-1002', { reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', stage: 'INQUIRY', amount: 48 });

test('strong tracked case recommends fighting', () => {
  const a = assess(ceramics);
  assert.equal(a.strength, 90);
  assert.equal(a.recommended, 'FIGHT');
});

test('weak low-value case does not recommend fighting', () => {
  assert.notEqual(assess(jacket).recommended, 'FIGHT');
});

test('adding evidence raises strength and lowers fight cost', () => {
  const before = assess(jacket);
  const after = assess({ ...jacket, evidence: { ...jacket.evidence, photos: true, messages: true } });
  assert.ok(after.strength > before.strength);
  const cost = (a) => a.options.find((o) => o.id === 'FIGHT').expectedCost;
  assert.ok(cost(after) < cost(before));
});

test('win estimate is capped so we never claim certainty', () => {
  const all = Object.fromEntries(assess(ceramics).checklist.map((x) => [x.id, true]));
  assert.match(assess({ ...ceramics, evidence: all }).options[0].detail, /90% chance/);
});

test('partial offers exist only during inquiry', () => {
  assert.ok(assess(jacket).options.some((o) => o.id === 'PARTIAL'));
  assert.ok(!assess(ceramics).options.some((o) => o.id === 'PARTIAL'));
});

test('fight filing carries tracking in PayPal format', () => {
  const f = buildFiling(ceramics, 'FIGHT', 'Delivered.');
  assert.equal(f.call, 'provideEvidence');
  assert.equal(f.args.evidences[0].evidence_type, 'PROOF_OF_FULFILLMENT');
  assert.equal(f.args.evidences[0].evidence_info.tracking_info[0].carrier_name, 'USPS');
});

test('evidence is one entry, as the real sandbox requires', () => {
  const f = buildFiling(ceramics, 'FIGHT', 'Delivered.');
  assert.equal(f.args.evidences.length, 1);
  assert.match(f.args.evidences[0].notes, /Delivered\.[\s\S]*Also available/);
});

test('refund uses an offer type PayPal allows', () => {
  const f = buildFiling({ ...jacket, offerTypes: ['REFUND'] }, 'REFUND', 'ok');
  assert.equal(f.args.offer_type, 'REFUND');
});

test('refund maps by stage', () => {
  assert.equal(buildFiling(jacket, 'REFUND', 'ok').args.offer_type, 'REFUND_WITH_RETURN');
  assert.equal(buildFiling(ceramics, 'REFUND', 'ok').call, 'acceptClaim');
});

test('empty notes are rejected', () => {
  assert.throws(() => buildFiling(ceramics, 'FIGHT', '  '));
});
