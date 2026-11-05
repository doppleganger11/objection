import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createLivePayPal } from '../server/paypal/live.js';

async function withServer(fn) {
  const server = createApp({ env: {} }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  try { await fn(api); } finally { server.close(); }
}

test('full flow: hearing, confirm gate, file, settle', () => withServer(async (api) => {
  const id = 'PP-D-DEMO-1001';
  assert.equal((await api('GET', '/api/status')).data.paypal, 'simulated');
  const hearing = (await api('POST', `/api/disputes/${id}/hearing`)).data;
  assert.equal(hearing.source, 'scripted');
  assert.ok(hearing.transcript.length >= 4);

  const blocked = await api('POST', `/api/disputes/${id}/file`, { optionId: 'FIGHT', note: 'x' });
  assert.equal(blocked.status, 400);

  const ok = await api('POST', `/api/disputes/${id}/file`, { optionId: 'FIGHT', note: hearing.filingNote, confirmed: true });
  assert.equal(ok.data.case.status, 'UNDER_REVIEW');

  const again = await api('POST', `/api/disputes/${id}/file`, { optionId: 'FIGHT', note: 'x', confirmed: true });
  assert.equal(again.status, 400);

  const done = await api('POST', `/api/disputes/${id}/settle`, { outcome: 'SELLER_FAVOR' });
  assert.equal(done.data.case.outcome, 'RESOLVED_SELLER_FAVOUR');
  assert.ok((await api('GET', '/api/activity')).data.some((e) => e.path.endsWith('/provide-evidence')));
}));

test('locker updates change the assessment', () => withServer(async (api) => {
  const id = 'PP-D-DEMO-1002';
  const before = (await api('GET', `/api/disputes/${id}`)).data.assessment.strength;
  const after = (await api('PATCH', `/api/disputes/${id}/locker`, { evidence: { photos: true } })).data.assessment.strength;
  assert.equal(after, before + 25);
}));

test('live client refuses non-sandbox hosts', () => {
  assert.throws(() => createLivePayPal({ clientId: 'a', clientSecret: 'b', baseUrl: 'https://api-m.paypal.com' }));
});

test('live client sends the documented evidence request', async () => {
  const calls = [];
  const fetchImpl = async (u, o) => {
    calls.push({ u, o });
    return new Response(JSON.stringify(u.endsWith('/token') ? { access_token: 't', expires_in: 3600 } : {}), { status: 200 });
  };
  const pp = createLivePayPal({ clientId: 'a', clientSecret: 'b', fetchImpl });
  await pp.provideEvidence('D 1', { evidences: [] });
  assert.equal(calls[1].u, 'https://api-m.sandbox.paypal.com/v1/customer/disputes/D%201/provide-evidence');
  assert.equal(calls[1].o.headers.Authorization, 'Bearer t');
});

test('evidence goes as multipart with an input part, as PayPal documents', async () => {
  const calls = [];
  const fetchImpl = async (u, o) => {
    calls.push({ u, o });
    return new Response(JSON.stringify(u.endsWith('/token') ? { access_token: 't', expires_in: 3600 } : {}), { status: 200 });
  };
  const pp = createLivePayPal({ clientId: 'a', clientSecret: 'b', fetchImpl });
  await pp.provideEvidence('D1', { evidences: [{ evidence_type: 'OTHER', notes: 'n' }] });
  const body = calls[1].o.body;
  assert.ok(body instanceof FormData);
  assert.equal(calls[1].o.headers['Content-Type'], undefined);
  assert.match(await body.get('input').text(), /"evidence_type":"OTHER"/);
});

test('falls back to JSON if the host answers 415', async () => {
  const calls = [];
  const fetchImpl = async (u, o) => {
    calls.push(o);
    if (u.endsWith('/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    return new Response('{}', { status: calls.length === 2 ? 415 : 200 });
  };
  const pp = createLivePayPal({ clientId: 'a', clientSecret: 'b', fetchImpl });
  await pp.acceptClaim('D1', { note: 'n' });
  assert.equal(calls[2].headers['Content-Type'], 'application/json');
});

test('list fetches each dispute for full details', async () => {
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(u);
    if (u.endsWith('/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    if (u.includes('page_size')) return new Response(JSON.stringify({ items: [{ dispute_id: 'A' }] }));
    return new Response(JSON.stringify({ dispute_id: 'A', disputed_transactions: [{ items: [{ item_name: 'Mug' }] }] }));
  };
  const pp = createLivePayPal({ clientId: 'a', clientSecret: 'b', fetchImpl });
  const [d] = await pp.listDisputes();
  assert.equal(d.disputed_transactions[0].items[0].item_name, 'Mug');
});

test('a sandbox-shaped dispute maps to a case, and disallowed actions stop early', async () => {
  const dispute = {
    dispute_id: 'S1', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_life_cycle_stage: 'INQUIRY', dispute_amount: { currency_code: 'USD', value: '20.00' },
    disputed_transactions: [{ buyer: { name: 'Test Buyer' }, items: [{ item_name: 'Mug' }] }],
    messages: [{ posted_by: 'BUYER', content: 'Where is my mug?' }],
    links: [{ rel: 'self' }, { rel: 'make_offer' }],
  };
  let called = 0;
  const paypal = {
    mode: 'sandbox', listDisputes: async () => [dispute], getDispute: async () => dispute,
    provideEvidence: async () => { called += 1; }, makeOffer: async () => { called += 1; },
  };
  const server = createApp({ env: {}, paypal }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const c = (await (await fetch(`${base}/api/disputes/S1`)).json()).case;
    assert.equal(c.item, 'Mug');
    assert.equal(c.buyerClaim, 'Where is my mug?');
    const post = (optionId) => fetch(`${base}/api/disputes/S1/file`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId, note: 'n', confirmed: true }),
    });
    assert.equal((await post('FIGHT')).status, 400);
    assert.equal(called, 0);
    assert.equal((await post('PARTIAL')).status, 200);
    assert.equal(called, 1);
  } finally { server.close(); }
});

test('escalate sends the documented request', async () => {
  const calls = [];
  const fetchImpl = async (u, o) => {
    calls.push({ u, o });
    return new Response(JSON.stringify(u.endsWith('/token') ? { access_token: 't', expires_in: 3600 } : {}));
  };
  const pp = createLivePayPal({ clientId: 'a', clientSecret: 'b', fetchImpl });
  await pp.escalate('D1', 'Please review');
  assert.match(calls[1].u, /\/D1\/escalate$/);
  assert.equal(JSON.parse(calls[1].o.body).note, 'Please review');
});

test('reset restores the simulated demo', () => withServer(async (api) => {
  const id = 'PP-D-DEMO-1001';
  await api('POST', `/api/disputes/${id}/file`, { optionId: 'FIGHT', note: 'x', confirmed: true });
  await api('POST', '/api/reset');
  assert.equal((await api('GET', `/api/disputes/${id}`)).data.case.status, 'WAITING_FOR_SELLER_RESPONSE');
}));
