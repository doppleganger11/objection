// In-memory stand-in with the same interface as live.js. The UI always labels
// this mode as simulated. Fictional data only.
const days = (n) => new Date(Date.now() + n * 864e5).toISOString();

const seed = () => [
  {
    dispute_id: 'PP-D-DEMO-1001', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_life_cycle_stage: 'CHARGEBACK', dispute_amount: { currency_code: 'USD', value: '186.00' },
    seller_response_due_date: days(6), create_time: days(-4),
    item: 'Hand-thrown stoneware dinner set', buyer: 'J. Ortega',
    buyerClaim: 'I never received the package. Nothing arrived at my house.',
  },
  {
    dispute_id: 'PP-D-DEMO-1002', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_life_cycle_stage: 'INQUIRY', dispute_amount: { currency_code: 'USD', value: '48.00' },
    seller_response_due_date: days(9), create_time: days(-1),
    item: 'Vintage denim jacket, size M', buyer: 'R. Lindqvist',
    buyerClaim: 'The jacket has a stain on the sleeve that was not in the photos.',
  },
  {
    dispute_id: 'PP-D-DEMO-1003', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_life_cycle_stage: 'CHARGEBACK', dispute_amount: { currency_code: 'USD', value: '64.00' },
    seller_response_due_date: days(2), create_time: days(-7),
    item: 'Photo preset pack (digital download)', buyer: 'T. Mbeki',
    buyerClaim: 'I paid but never got the download.',
  },
];

export const SEED_EVIDENCE = {
  'PP-D-DEMO-1001': {
    resaleValue: 90, carrier: 'USPS', trackingNumber: '9400 1000 0000 0000 0000 00',
    evidence: { tracking: true, delivered: true, addressMatch: true, signature: false, messages: true },
    facts: 'USPS shows delivered to the front door on the PayPal shipping address. No signature was collected. The buyer thanked the seller for fast shipping two days before the delivery scan.',
  },
  'PP-D-DEMO-1002': {
    resaleValue: 25,
    evidence: { listing: true, photos: false, messages: false, returnPolicy: true, buyerProof: false },
    facts: 'The listing said "good vintage condition". There are no photos of the sleeve. The buyer has sent a photo of a stain.',
  },
  'PP-D-DEMO-1003': {
    digital: true, resaleValue: 0,
    evidence: { accessLog: true, buyerIdentity: true, terms: true, messages: false },
    facts: 'The download log shows the file was fetched 3 minutes after payment, using the buyer email on the PayPal order.',
  },
};

export function createMockPayPal({ log }) {
  let items = seed();
  const find = (id) => {
    const d = items.find((x) => x.dispute_id === id);
    if (!d) throw new Error('Dispute not found');
    return d;
  };
  const record = (method, path, status = 200) =>
    log?.({ method, path: `/v1/customer/disputes/{id}${path}`, status, mode: 'simulated' });
  const requireWaiting = (d) => {
    if (d.status !== 'WAITING_FOR_SELLER_RESPONSE') throw new Error('This dispute is not waiting for a seller response');
  };
  return {
    mode: 'simulated',
    reset: () => { items = seed(); },
    listDisputes: async () => { log?.({ method: 'GET', path: '/v1/customer/disputes', status: 200, mode: 'simulated' }); return items; },
    getDispute: async (id) => { record('GET', ''); return find(id); },
    provideEvidence: async (id) => { const d = find(id); requireWaiting(d); d.status = 'UNDER_REVIEW'; record('POST', '/provide-evidence'); return {}; },
    makeOffer: async (id) => {
      const d = find(id); requireWaiting(d);
      if (d.dispute_life_cycle_stage !== 'INQUIRY') throw new Error('Offers are only possible during inquiry');
      d.status = 'WAITING_FOR_BUYER_RESPONSE'; record('POST', '/make-offer'); return {};
    },
    acceptClaim: async (id) => { const d = find(id); d.status = 'RESOLVED'; d.dispute_outcome = { outcome_code: 'RESOLVED_BUYER_FAVOUR' }; record('POST', '/accept-claim'); return {}; },
    escalate: async (id) => { const d = find(id); d.status = 'UNDER_REVIEW'; record('POST', '/escalate'); return {}; },
    requireEvidence: async (id) => { const d = find(id); d.status = 'WAITING_FOR_SELLER_RESPONSE'; record('POST', '/require-evidence'); return {}; },
    adjudicate: async (id, outcome) => {
      const d = find(id);
      if (d.status !== 'UNDER_REVIEW') throw new Error('Only disputes under review can be settled');
      d.status = 'RESOLVED';
      d.dispute_outcome = { outcome_code: outcome === 'SELLER_FAVOR' ? 'RESOLVED_SELLER_FAVOUR' : 'RESOLVED_BUYER_FAVOUR' };
      record('POST', '/adjudicate'); return {};
    },
  };
}
