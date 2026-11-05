// Morning setup check: npm run check
// Read-only. Signs in to the PayPal sandbox, lists disputes, and runs one hearing.
// Prints what is working and what to do next. Never prints a secret.
import { assess } from '../server/rules.js';
import { runTrial } from '../server/trial.js';
import { createLivePayPal } from '../server/paypal/live.js';
import { SEED_EVIDENCE } from '../server/paypal/mock.js';

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL, GEMINI_API_KEY } = process.env;
let failed = false;
const ok = (m) => console.log(`OK    ${m}`);
const todo = (m) => { failed = true; console.log(`TO DO ${m}`); };

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  todo('Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env (Developer Dashboard, Apps & Credentials, Sandbox).');
} else {
  try {
    const pp = createLivePayPal({ clientId: PAYPAL_CLIENT_ID, clientSecret: PAYPAL_CLIENT_SECRET, baseUrl: PAYPAL_BASE_URL });
    const disputes = await pp.listDisputes();
    ok(`PayPal sandbox sign-in works. ${disputes.length} dispute(s) found.`);
    if (!disputes.length) todo('Create a test dispute. See "Create a sandbox dispute" in the README.');
    for (const d of disputes) {
      console.log(`      ${d.dispute_id}: ${d.reason}, ${d.status}, ${d.dispute_life_cycle_stage}`);
      console.log(`      allowed actions: ${(d.links ?? []).map((l) => l.rel).join(', ') || 'none listed'}`);
    }
  } catch (err) {
    todo(`PayPal: ${err.message}`);
  }
}

if (!GEMINI_API_KEY) {
  todo('Add GEMINI_API_KEY to .env (free key from aistudio.google.com/apikey).');
} else {
  const c = {
    ...SEED_EVIDENCE['PP-D-DEMO-1001'], id: 'check', currency: 'USD', amount: 186, stage: 'CHARGEBACK',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', item: 'Stoneware dinner set', buyerClaim: 'I never received the package.',
  };
  const trial = await runTrial(c, assess(c));
  if (trial.source === 'ai') ok(`Gemini hearing works (${trial.transcript.length} turns, judge leans ${trial.lean}).`);
  else todo(`Gemini: ${trial.aiError ?? 'fell back to the script'}`);
}

console.log(failed ? '\nFix the TO DO lines, then run this again.' : '\nEverything is ready.');
process.exitCode = failed ? 1 : 0;
