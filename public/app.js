const $ = (id) => document.getElementById(id);
const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorised payment',
};
const STAGES = { INQUIRY: 'Inquiry', CHARGEBACK: 'Claim', PRE_ARBITRATION: 'Pre-arbitration', ARBITRATION: 'Arbitration' };
const LEANS = { SELLER: 'The judge leans your way', BUYER: 'The judge leans to the buyer', TOSS_UP: 'This could go either way' };
const OUTCOMES = {
  RESOLVED_SELLER_FAVOUR: 'Decided in your favour. You keep the money.',
  RESOLVED_BUYER_FAVOUR: 'Decided for the buyer.',
};

let grid = null;
let current = null; // { case, assessment }
let selected = null;
let hearing = null;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 6000);
}

const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { toast(err.message); }
};

const usd = (n) => `$${Number(n).toFixed(2)}`;
function dueText(iso) {
  if (!iso) return 'Check PayPal';
  const days = Math.ceil((new Date(iso) - Date.now()) / 864e5);
  return days <= 0 ? 'Overdue' : `${days} day${days === 1 ? '' : 's'}`;
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

async function loadStatus() {
  const s = await api('GET', '/api/status');
  $('badges').replaceChildren(
    s.paypal === 'sandbox' ? badge('PayPal Sandbox', 'good') : badge('Simulated PayPal', 'warn'),
    s.ai === 'gemini' ? badge('Gemini hearing', 'good') : badge('Scripted hearing', 'warn'),
  );
  if (s.paypal === 'simulated') {
    const reset = document.createElement('button');
    reset.className = 'small';
    reset.textContent = 'Reset demo';
    reset.addEventListener('click', guard(async () => {
      await api('POST', '/api/reset');
      location.reload();
    }));
    $('badges').append(reset);
  }
}

async function loadDocket() {
  const rows = await api('GET', '/api/disputes');
  if (!grid) {
    grid = agGrid.createGrid($('docket'), {
      rowData: rows,
      rowSelection: 'single',
      getRowId: (p) => p.data.id,
      defaultColDef: { sortable: true, resizable: true },
      columnDefs: [
        { field: 'item', headerName: 'Item', flex: 2, minWidth: 220 },
        { field: 'reason', headerName: 'Reason', minWidth: 150, valueFormatter: (p) => REASONS[p.value] ?? p.value },
        { field: 'amount', headerName: 'Amount', width: 110, valueFormatter: (p) => usd(p.value) },
        { field: 'dueDate', headerName: 'Respond in', width: 120, valueFormatter: (p) => dueText(p.value) },
        { field: 'strength', headerName: 'Case strength', width: 130, valueFormatter: (p) => `${p.value}/100` },
        { field: 'status', headerName: 'Status', minWidth: 130, valueFormatter: (p) => statusText(p.value) },
      ],
      onRowClicked: (p) => guard(openCase)(p.data.id),
    });
  } else {
    grid.setGridOption('rowData', rows);
  }
  return rows;
}

function statusText(s) {
  return { WAITING_FOR_SELLER_RESPONSE: 'Needs you', UNDER_REVIEW: 'With PayPal', WAITING_FOR_BUYER_RESPONSE: 'With buyer', RESOLVED: 'Closed' }[s] ?? 'Open';
}

async function openCase(id) {
  current = await api('GET', `/api/disputes/${encodeURIComponent(id)}`);
  selected = current.assessment.recommended;
  hearing = null;
  $('transcript').replaceChildren();
  $('verdict').hidden = true;
  $('note').value = '';
  $('hear').textContent = 'Start the hearing';
  $('case').hidden = false;
  grid?.getRowNode(id)?.setSelected(true);
  render();
  await loadActivity();
  $('case').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  const { case: c, assessment: a } = current;
  $('c-reason').textContent = REASONS[c.reason] ?? c.reason;
  $('c-item').textContent = c.item;
  $('c-claim').textContent = c.buyerClaim || 'No statement yet.';
  $('c-amount').textContent = usd(c.amount);
  $('c-due').textContent = dueText(c.dueDate);
  $('c-stage').textContent = STAGES[c.stage] ?? c.stage;
  $('meter').style.width = `${a.strength}%`;
  $('meter-wrap').setAttribute('aria-label', `Case strength ${a.strength} out of 100`);
  $('meter-label').textContent = `Case strength ${a.strength}/100${a.missing[0] ? `. Biggest gap: ${a.missing[0].label.toLowerCase()}.` : '.'}`;
  if (document.activeElement !== $('facts')) $('facts').value = c.facts ?? '';
  $('tracking-fields').hidden = !a.checklist.some((x) => x.id === 'tracking');
  $('carrier').value = c.carrier ?? 'OTHER';
  $('tracking-number').value = c.trackingNumber ?? '';

  $('checks').replaceChildren(...a.checklist.map((x) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = x.have;
    box.addEventListener('change', guard(() => updateLocker({ evidence: { [x.id]: box.checked } })));
    const text = document.createElement('span');
    text.textContent = x.label;
    const weight = document.createElement('small');
    weight.textContent = `+${x.weight}`;
    label.append(box, text, weight);
    li.append(label);
    return li;
  }));

  const available = a.options;
  if (!available.some((o) => o.id === selected)) selected = a.recommended;
  const max = Math.max(...available.map((o) => o.expectedCost), 1);
  $('options').replaceChildren(...available.map((o) => {
    const b = document.createElement('button');
    b.className = `option${o.id === selected ? ' selected' : ''}`;
    b.setAttribute('aria-pressed', String(o.id === selected));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = o.label;
    if (o.id === a.recommended) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Lowest expected cost';
      name.append(tag);
    }
    const cost = document.createElement('span');
    cost.className = 'cost';
    cost.textContent = usd(o.expectedCost);
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.width = `${Math.max(2, (o.expectedCost / max) * 100)}%`;
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = o.detail;
    b.append(name, cost, bar, detail);
    b.addEventListener('click', () => { selected = o.id; render(); });
    return b;
  }));

  const chosen = available.find((o) => o.id === selected);
  $('filing-summary').textContent = `You are about to: ${chosen.label.toLowerCase()}.`;
  const waiting = c.status === 'WAITING_FOR_SELLER_RESPONSE';
  $('file').hidden = !waiting;
  renderFiled();
}

function renderFiled() {
  const { case: c } = current;
  const box = $('filed');
  box.hidden = !c.filed && !c.outcome && c.status === 'WAITING_FOR_SELLER_RESPONSE';
  if (box.hidden) return;
  const p = document.createElement('p');
  p.textContent = OUTCOMES[c.outcome] ?? (c.filed ? `Filed: ${c.filed.summary}. Status: ${statusText(c.status)}.` : `Status: ${statusText(c.status)}.`);
  const nodes = [p];
  if (c.status === 'OPEN') {
    const b = document.createElement('button');
    b.textContent = 'Test step: ask the seller for evidence';
    b.addEventListener('click', guard(async () => {
      current.case = (await api('POST', `/api/disputes/${encodeURIComponent(c.id)}/require-evidence`)).case;
      render();
      await Promise.all([loadDocket(), loadActivity()]);
    }));
    nodes.push(b);
  }
  if (c.links?.includes('escalate') && c.status === 'WAITING_FOR_BUYER_RESPONSE') {
    const b = document.createElement('button');
    b.textContent = 'Ask PayPal to review';
    b.addEventListener('click', guard(async () => {
      current.case = (await api('POST', `/api/disputes/${encodeURIComponent(c.id)}/escalate`)).case;
      render();
      await Promise.all([loadDocket(), loadActivity()]);
    }));
    nodes.push(b);
  }
  // The simulated cases have no links. In the sandbox, PayPal says when a ruling is allowed.
  if (c.status === 'UNDER_REVIEW' && (!c.links?.length || c.links.includes('adjudicate'))) {
    const row = document.createElement('div');
    row.className = 'row';
    const mk = (label, outcome) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', guard(async () => {
        current.case = (await api('POST', `/api/disputes/${encodeURIComponent(c.id)}/settle`, { outcome })).case;
        render();
        await Promise.all([loadDocket(), loadActivity()]);
      }));
      return b;
    };
    row.append(mk('Test decision: seller wins', 'SELLER_FAVOR'), mk('Test decision: buyer wins', 'BUYER_FAVOR'));
    nodes.push(row);
  }
  box.replaceChildren(...nodes);
}

async function updateLocker(patch) {
  current = await api('PATCH', `/api/disputes/${encodeURIComponent(current.case.id)}/locker`, patch);
  selected = current.assessment.recommended;
  if (hearing && patch.evidence) {
    // The old hearing no longer matches the file.
    hearing = null;
    $('transcript').replaceChildren();
    $('verdict').hidden = true;
    $('hear').textContent = 'Evidence changed. Run it again';
  }
  render();
  await loadDocket();
}

async function runHearing() {
  const btn = $('hear');
  btn.disabled = true;
  btn.textContent = 'In session…';
  $('transcript').replaceChildren();
  $('verdict').hidden = true;
  try {
    hearing = await api('POST', `/api/disputes/${encodeURIComponent(current.case.id)}/hearing`);
    if (hearing.aiError) toast(`Gemini was unavailable, so this is the scripted hearing. ${hearing.aiError}`);
    for (const turn of hearing.transcript) {
      const li = document.createElement('li');
      li.className = `t-${turn.speaker}`;
      const who = document.createElement('b');
      who.textContent = turn.speaker;
      li.append(who, document.createTextNode(turn.text));
      $('transcript').append(li);
      await new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450));
    }
    const v = $('verdict');
    const title = document.createElement('strong');
    title.textContent = LEANS[hearing.lean] ?? 'Hearing finished';
    const why = document.createElement('p');
    why.textContent = hearing.reasoning;
    const weak = document.createElement('p');
    weak.textContent = `Weakest point: ${hearing.weakestPoint}`;
    v.replaceChildren(title, why, weak);
    v.hidden = false;
    if (!$('note').value.trim()) $('note').value = hearing.filingNote;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run it again';
  }
}

async function file() {
  const btn = $('file');
  btn.disabled = true;
  btn.textContent = 'Filing with PayPal…';
  try {
    const result = await api('POST', `/api/disputes/${encodeURIComponent(current.case.id)}/file`, {
      optionId: selected, note: $('note').value, confirmed: true,
    });
    current.case = result.case;
    render();
    await Promise.all([loadDocket(), loadActivity()]);
  } finally {
    btn.disabled = false;
    btn.textContent = 'File with PayPal';
  }
}

async function loadActivity() {
  const items = await api('GET', '/api/activity');
  $('activity').replaceChildren(...items.slice(0, 8).map((e) => {
    const li = document.createElement('li');
    li.textContent = `${e.method} ${e.path} → ${e.status}${e.mode === 'simulated' ? ' (simulated)' : ''}`;
    return li;
  }));
}

$('hear').addEventListener('click', guard(runHearing));
$('file').addEventListener('click', guard(file));
$('facts').addEventListener('change', guard(() => updateLocker({ facts: $('facts').value })));
$('carrier').addEventListener('change', guard(() => updateLocker({ carrier: $('carrier').value })));
$('tracking-number').addEventListener('change', guard(() => updateLocker({ trackingNumber: $('tracking-number').value })));

guard(async () => {
  await loadStatus();
  const rows = await loadDocket();
  if (rows[0]) await openCase(rows[0].id);
  else toast('No open disputes in this sandbox account yet. See "Create a sandbox dispute" in the README.');
  window.scrollTo(0, 0);
})();
