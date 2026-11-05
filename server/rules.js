// Deterministic money logic. The AI argues; it never sets amounts or picks the
// action. Weights and assumptions are estimates and are shown to the seller.

export const ASSUMPTIONS = {
  disputeFee: 15, // PayPal Standard Dispute Fee (USD). Confirm in your account terms.
  partialOfferShare: 0.4, // share of the amount offered in a partial refund
  partialAcceptChance: 0.5, // assumed chance a buyer takes a partial offer
};

const CHECKS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: [
    ['tracking', 'Carrier tracking number', 30],
    ['delivered', 'Tracking shows delivered', 30],
    ['addressMatch', 'Delivered to the PayPal shipping address', 20],
    ['signature', 'Signature on delivery', 10],
    ['messages', 'Messages with the buyer', 10],
  ],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: [
    ['listing', 'Original listing text and photos', 25],
    ['photos', 'Photos of the exact item before shipping', 25],
    ['messages', 'Messages showing the buyer knew the condition', 20],
    ['returnPolicy', 'Published return policy', 15],
    ['buyerProof', 'Buyer sent no proof of the problem', 15],
  ],
  UNAUTHORISED: [
    ['tracking', 'Carrier tracking number', 25],
    ['delivered', 'Tracking shows delivered', 25],
    ['addressMatch', 'Delivered to the PayPal shipping address', 30],
    ['priorOrders', 'Earlier orders from the same buyer', 20],
  ],
  DIGITAL: [
    ['accessLog', 'Dated download or access log', 45],
    ['buyerIdentity', 'Download matches the buyer email or IP', 25],
    ['terms', 'Terms shown before purchase', 15],
    ['messages', 'Messages with the buyer', 15],
  ],
};

export function checklistFor(c) {
  const key = c.digital ? 'DIGITAL' : c.reason;
  return (CHECKS[key] ?? CHECKS.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED).map(
    ([id, label, weight]) => ({ id, label, weight, have: Boolean(c.evidence?.[id]) }),
  );
}

const money = (n) => Math.round(n * 100) / 100;

export function assess(c) {
  const { disputeFee, partialOfferShare, partialAcceptChance } = ASSUMPTIONS;
  const checklist = checklistFor(c);
  const strength = checklist.reduce((sum, x) => sum + (x.have ? x.weight : 0), 0);
  const p = Math.min(0.9, strength / 100); // never claim a sure win
  const amount = c.amount;
  const inquiry = c.stage === 'INQUIRY';
  const lossIfFight = amount + disputeFee;

  const fight = money((1 - p) * lossIfFight);
  const returnValue = c.digital ? 0 : (c.resaleValue ?? 0);
  const refund = money(amount - returnValue + (inquiry ? 0 : disputeFee));

  const options = [
    {
      id: 'FIGHT',
      label: 'Fight with evidence',
      expectedCost: fight,
      detail: `Our estimate: ${Math.round(p * 100)}% chance of winning. Losing costs $${lossIfFight.toFixed(2)}.`,
      available: true,
    },
    {
      id: 'REFUND',
      label: returnValue > 0 ? 'Refund if the item comes back' : 'Refund in full',
      expectedCost: refund,
      detail: inquiry
        ? `No dispute fee at this stage.${returnValue > 0 ? ` You recover about $${returnValue} of value.` : ''}`
        : `A $${disputeFee} dispute fee can apply now this is past inquiry.`,
      available: true,
    },
  ];

  if (inquiry) {
    const offer = money(amount * partialOfferShare);
    options.push({
      id: 'PARTIAL',
      label: `Offer a $${offer.toFixed(2)} partial refund`,
      offerAmount: offer,
      expectedCost: money(partialAcceptChance * offer + (1 - partialAcceptChance) * Math.min(fight, refund)),
      detail: `Assumes a ${partialAcceptChance * 100}% chance the buyer accepts; otherwise you still choose the cheaper path.`,
      available: true,
    });
  }

  const recommended = [...options].sort((a, b) => a.expectedCost - b.expectedCost)[0];
  return {
    strength,
    checklist,
    missing: checklist.filter((x) => !x.have).sort((a, b) => b.weight - a.weight),
    options,
    recommended: recommended.id,
    savedVersusWorst: money(Math.max(...options.map((o) => o.expectedCost)) - recommended.expectedCost),
    assumptions: ASSUMPTIONS,
  };
}

const LINK_FOR_CALL = { provideEvidence: 'provide_evidence', makeOffer: 'make_offer', acceptClaim: 'accept_claim' };

// PayPal lists what a dispute allows right now. Stop early with a clear message.
export function filingProblem(c, filing) {
  const rel = LINK_FOR_CALL[filing.call];
  if (c.links?.length && !c.links.some((l) => l.replace(/-/g, '_') === rel)) {
    return `PayPal doesn't allow "${filing.summary}" on this dispute right now.`;
  }
  const type = filing.args.offer_type;
  if (type && c.offerTypes?.length && !c.offerTypes.includes(type)) {
    return `PayPal doesn't allow this kind of offer here. Allowed: ${c.offerTypes.join(', ')}.`;
  }
  return null;
}

const TRACKING_TYPES = new Set(['tracking', 'delivered']);

// Turns the chosen option into the exact PayPal action. Pure, so it is testable.
export function buildFiling(c, optionId, note) {
  const a = assess(c);
  const option = a.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`Option ${optionId} is not available for this case`);
  const text = String(note ?? '').trim().slice(0, 2000);
  if (!text) throw new Error('A note is required');

  if (optionId === 'FIGHT') {
    // PayPal rejects several evidence entries without item ids, so send one.
    const listed = a.checklist.filter((x) => x.have && !TRACKING_TYPES.has(x.id)).map((x) => x.label);
    const notes = (listed.length ? `${text}\n\nAlso available: ${listed.join('; ')}.` : text).slice(0, 2000);
    const evidence = c.evidence?.tracking && c.trackingNumber
      ? {
        evidence_type: 'PROOF_OF_FULFILLMENT',
        evidence_info: { tracking_info: [{ carrier_name: c.carrier ?? 'OTHER', tracking_number: c.trackingNumber }] },
        notes,
      }
      : { evidence_type: 'OTHER', notes };
    return { call: 'provideEvidence', args: { evidences: [evidence] }, summary: 'Submit evidence' };
  }

  if (optionId === 'PARTIAL') {
    return {
      call: 'makeOffer',
      args: { note: text, offer_amount: { currency_code: c.currency, value: option.offerAmount.toFixed(2) }, offer_type: 'REFUND' },
      summary: `Offer ${c.currency} ${option.offerAmount.toFixed(2)}`,
    };
  }

  if (c.stage === 'INQUIRY') {
    const wantsReturn = !c.digital && (c.resaleValue ?? 0) > 0;
    const withReturn = wantsReturn && (!c.offerTypes?.length || c.offerTypes.includes('REFUND_WITH_RETURN'));
    return {
      call: 'makeOffer',
      args: {
        note: text,
        offer_amount: { currency_code: c.currency, value: c.amount.toFixed(2) },
        offer_type: withReturn ? 'REFUND_WITH_RETURN' : 'REFUND',
      },
      summary: `Offer a full refund of ${c.currency} ${c.amount.toFixed(2)}`,
    };
  }
  return { call: 'acceptClaim', args: { note: text }, summary: 'Accept the claim and refund' };
}
