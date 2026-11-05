// Thin client for the PayPal Disputes API. Sandbox only, by design.
const SANDBOX_HOST = 'api-m.sandbox.paypal.com';

export function createLivePayPal({ clientId, clientSecret, baseUrl, log, fetchImpl = fetch }) {
  const url = new URL(baseUrl || `https://${SANDBOX_HOST}`);
  if (url.hostname !== SANDBOX_HOST) throw new Error('Objection! only talks to the PayPal sandbox');
  let token = null;
  let tokenExpires = 0;

  async function auth() {
    if (token && Date.now() < tokenExpires) return token;
    const res = await fetchImpl(`${url.origin}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal sign-in failed (${res.status})`);
    const data = await res.json();
    token = data.access_token;
    tokenExpires = Date.now() + (data.expires_in - 60) * 1000;
    return token;
  }

  async function send(method, path, { json, form } = {}) {
    const headers = { Authorization: `Bearer ${await auth()}` };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(`${url.origin}${path}`, {
      method,
      headers,
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
    });
    const text = await res.text();
    const shown = path.replace(/\/disputes\/[^/?]+/, '/disputes/{id}');
    log?.({ method, path: shown, status: res.status, mode: 'sandbox' });
    return { res, text, shown };
  }

  async function call(method, path, json) {
    const { res, text, shown } = await send(method, path, { json });
    if (!res.ok) throw new Error(`PayPal ${method} ${shown} failed (${res.status}): ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }

  // PayPal documents these actions as multipart/form-data, with the JSON in an
  // "input" part. Fall back to plain JSON if a host answers 415.
  async function multipart(path, input) {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    let out = await send('POST', path, { form });
    if (out.res.status === 415) out = await send('POST', path, { json: input });
    if (!out.res.ok) throw new Error(`PayPal POST ${out.shown} failed (${out.res.status}): ${out.text.slice(0, 300)}`);
    return out.text ? JSON.parse(out.text) : {};
  }

  const id = (x) => encodeURIComponent(x);
  const getDispute = (x) => call('GET', `/v1/customer/disputes/${id(x)}`);
  return {
    mode: 'sandbox',
    // The list is a summary, so fetch each dispute for its item, buyer and messages.
    async listDisputes() {
      const items = (await call('GET', '/v1/customer/disputes?page_size=20')).items ?? [];
      return Promise.all(items.map((d) => getDispute(d.dispute_id)));
    },
    getDispute,
    provideEvidence: (x, args) => multipart(`/v1/customer/disputes/${id(x)}/provide-evidence`, args),
    makeOffer: (x, args) => call('POST', `/v1/customer/disputes/${id(x)}/make-offer`, args),
    acceptClaim: (x, args) => multipart(`/v1/customer/disputes/${id(x)}/accept-claim`, args),
    escalate: (x, note) => call('POST', `/v1/customer/disputes/${id(x)}/escalate`, { note }),
    requireEvidence: (x) => call('POST', `/v1/customer/disputes/${id(x)}/require-evidence`, { action: 'SELLER_EVIDENCE' }),
    adjudicate: (x, outcome) => call('POST', `/v1/customer/disputes/${id(x)}/adjudicate`, { adjudication_outcome: outcome }),
  };
}
