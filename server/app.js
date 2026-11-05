import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assess, buildFiling, filingProblem } from './rules.js';
import { runTrial } from './trial.js';
import { createLivePayPal } from './paypal/live.js';
import { createMockPayPal, SEED_EVIDENCE } from './paypal/mock.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ env = process.env, paypal, trial = runTrial } = {}) {
  const activity = [];
  const log = (e) => { activity.unshift({ at: new Date().toISOString(), ...e }); activity.length = Math.min(activity.length, 50); };
  const pp = paypal ?? (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.USE_SIMULATED_PAYPAL !== 'true'
    ? createLivePayPal({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, baseUrl: env.PAYPAL_BASE_URL, log })
    : createMockPayPal({ log }));

  // The seller's own records live here, keyed by dispute. PayPal does not hold them.
  let lockers = new Map(Object.entries(pp.mode === 'simulated' ? structuredClone(SEED_EVIDENCE) : {}));
  const filed = new Map();

  // Caps paid AI use if a hosted demo gets busy.
  const hearingTimes = [];
  const hearingLimit = Number(env.HEARINGS_PER_HOUR) || 30;
  function checkHearingLimit() {
    const hourAgo = Date.now() - 36e5;
    while (hearingTimes.length && hearingTimes[0] < hourAgo) hearingTimes.shift();
    if (hearingTimes.length >= hearingLimit) throw new Error('The demo has reached its hearing limit for this hour. Please try again later.');
    hearingTimes.push(Date.now());
  }

  function toCase(d) {
    const locker = lockers.get(d.dispute_id) ?? { evidence: {} };
    const tx = d.disputed_transactions?.[0];
    const item = tx?.items?.[0];
    return {
      digital: Boolean(item?.digital_download_details),
      links: (d.links ?? []).map((l) => l.rel),
      offerTypes: d.allowed_response_options?.make_offer?.offer_types ?? null,
      id: d.dispute_id,
      reason: d.reason,
      stage: d.dispute_life_cycle_stage,
      status: d.status,
      amount: Number(d.dispute_amount?.value ?? 0),
      currency: d.dispute_amount?.currency_code ?? 'USD',
      dueDate: d.seller_response_due_date ?? null,
      item: d.item ?? item?.item_name ?? item?.item_description ?? 'Item in this dispute',
      buyer: d.buyer ?? tx?.buyer?.name ?? 'Buyer',
      buyerClaim: d.buyerClaim ?? d.messages?.find((m) => m.posted_by === 'BUYER')?.content ?? item?.notes ?? '',
      outcome: d.dispute_outcome?.outcome_code ?? null,
      filed: filed.get(d.dispute_id) ?? null,
      ...locker,
    };
  }

  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(here, '..', 'public')));
  app.use('/vendor', express.static(path.join(here, '..', 'node_modules', 'ag-grid-community', 'dist')));

  const route = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (err) { res.status(400).json({ error: err.message }); }
  };
  const loadCase = async (id) => toCase(await pp.getDispute(id));

  app.get('/api/status', route(async () => ({ paypal: pp.mode, ai: env.GEMINI_API_KEY ? 'gemini' : 'scripted' })));
  app.get('/api/activity', route(async () => activity));
  app.get('/api/disputes', route(async () => {
    const list = await pp.listDisputes();
    return list.map((d) => { const c = toCase(d); const a = assess(c); return { ...c, strength: a.strength, recommended: a.recommended }; });
  }));
  app.get('/api/disputes/:id', route(async (req) => {
    const c = await loadCase(req.params.id);
    return { case: c, assessment: assess(c) };
  }));
  app.patch('/api/disputes/:id/locker', route(async (req) => {
    const id = req.params.id;
    await pp.getDispute(id);
    const cur = lockers.get(id) ?? { evidence: {} };
    const { evidence = {}, facts, trackingNumber, carrier } = req.body ?? {};
    const clean = Object.fromEntries(Object.entries(evidence).map(([k, v]) => [k, Boolean(v)]));
    lockers.set(id, {
      ...cur,
      evidence: { ...cur.evidence, ...clean },
      facts: typeof facts === 'string' ? facts.slice(0, 2000) : cur.facts,
      trackingNumber: typeof trackingNumber === 'string' ? trackingNumber.slice(0, 64) : cur.trackingNumber,
      carrier: typeof carrier === 'string' ? carrier.slice(0, 32) : cur.carrier,
    });
    const c = await loadCase(id);
    return { case: c, assessment: assess(c) };
  }));
  app.post('/api/reset', route(async () => {
    if (!pp.reset) throw new Error('Only the simulated demo can be reset');
    pp.reset();
    lockers = new Map(Object.entries(structuredClone(SEED_EVIDENCE)));
    filed.clear();
    activity.length = 0;
    return { ok: true };
  }));
  app.post('/api/disputes/:id/hearing', route(async (req) => {
    if (env.GEMINI_API_KEY) checkHearingLimit();
    const c = await loadCase(req.params.id);
    return trial(c, assess(c));
  }));
  // Nothing reaches PayPal until the seller presses File, which sends confirmed: true.
  app.post('/api/disputes/:id/file', route(async (req) => {
    const { optionId, note, confirmed } = req.body ?? {};
    if (confirmed !== true) throw new Error('The seller must confirm before anything is filed');
    const c = await loadCase(req.params.id);
    if (c.status !== 'WAITING_FOR_SELLER_RESPONSE') throw new Error('This dispute is not waiting for your response');
    const f = buildFiling(c, optionId, note);
    const problem = filingProblem(c, f);
    if (problem) throw new Error(problem);
    await pp[f.call](c.id, f.args);
    filed.set(c.id, { optionId, summary: f.summary, at: new Date().toISOString() });
    return { filing: f.summary, case: await loadCase(c.id) };
  }));
  // After an inquiry response the case returns to the buyer. This asks PayPal to review it.
  app.post('/api/disputes/:id/escalate', route(async (req) => {
    await pp.escalate(req.params.id, 'The seller has provided evidence and asks PayPal to review this case.');
    return { case: await loadCase(req.params.id) };
  }));
  // Sandbox and simulated only: moves a test case to where the seller can respond.
  app.post('/api/disputes/:id/require-evidence', route(async (req) => {
    await pp.requireEvidence(req.params.id);
    return { case: await loadCase(req.params.id) };
  }));
  // Sandbox and simulated only: lets the demo finish a case the way PayPal would.
  app.post('/api/disputes/:id/settle', route(async (req) => {
    const outcome = req.body?.outcome === 'BUYER_FAVOR' ? 'BUYER_FAVOR' : 'SELLER_FAVOR';
    await pp.adjudicate(req.params.id, outcome);
    return { case: await loadCase(req.params.id) };
  }));
  return app;
}
