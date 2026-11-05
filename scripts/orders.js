// Sandbox helper for making real test disputes. Fake money only.
//   npm run orders            creates demo orders and prints a payment link for each
//   npm run orders -- capture ORDER_ID [ORDER_ID...]   completes approved orders
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
const API = 'https://api-m.sandbox.paypal.com';

const DEMOS = [
  { name: 'Hand-thrown stoneware dinner set', value: '186.00' },
  { name: 'Vintage denim jacket, size M', value: '48.00' },
];

async function token() {
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal sign-in failed (${res.status})`);
  return (await res.json()).access_token;
}

async function post(path, auth, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

const orderBody = ({ name, value }) => ({
  intent: 'CAPTURE',
  purchase_units: [{
    description: name,
    amount: { currency_code: 'USD', value, breakdown: { item_total: { currency_code: 'USD', value } } },
    items: [{ name, quantity: '1', unit_amount: { currency_code: 'USD', value }, category: 'PHYSICAL_GOODS' }],
  }],
  payment_source: {
    paypal: {
      experience_context: {
        return_url: 'http://localhost:3000/', cancel_url: 'http://localhost:3000/', user_action: 'PAY_NOW',
      },
    },
  },
});

const [command, ...ids] = process.argv.slice(2);
const auth = await token();

if (command === 'capture') {
  for (const id of ids) {
    const done = await post(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, auth);
    console.log(`${id}: ${done.status}`);
  }
} else {
  for (const demo of DEMOS) {
    const order = await post('/v2/checkout/orders', auth, orderBody(demo));
    const link = order.links.find((l) => l.rel === 'payer-action')?.href;
    console.log(`${demo.name} ($${demo.value})\n  order: ${order.id}\n  pay: ${link}\n`);
  }
}
