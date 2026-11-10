# Objection!

Rehearse your PayPal dispute before you answer it.

A small seller gets a dispute, a deadline and little guidance. Objection! lets them see the strength of their case, watch two AI advocates argue it in front of an AI judge, compare what each choice is likely to cost, and file the response through PayPal after reviewing it.

Sometimes the right answer is not to fight. The app says so.

**Live demo:** https://objection-7zpy.onrender.com

The live demo uses fictional cases labelled **Simulated PayPal**, so anyone can replay them with **Reset demo**. The hearing is real Gemini output. The free server sleeps when unused, so the first visit can take about a minute to load.

## What it does

1. **Case list:** reads open disputes from the PayPal Disputes API.
2. **Evidence locker:** a checklist for that dispute type, with a case strength score.
3. **Practice hearing:** Gemini plays buyer advocate, seller advocate and judge, using only facts in the file, then drafts a note.
4. **Cost comparison:** fight, refund or partial offer, with an expected cost for each.
5. **Review and file:** nothing reaches PayPal until the seller presses File.

## How PayPal and AI are used

| Part | Used for |
|---|---|
| PayPal Disputes API | List and read disputes, provide evidence, make offers, accept claims |
| PayPal sandbox actions | `require-evidence` and `adjudicate` to complete a test case end to end |
| Google Gemini API (free tier) | The hearing, the judge's reasoning and the draft note, returned as JSON |
| AG Grid Community | The dispute list |

### Guardrails

- Dollar figures and the recommendation come from `server/rules.js`, never from the model.
- The buyer's text is fenced as untrusted data in the prompt.
- Win chance is capped at 90%. All estimates are labelled as estimates.
- The PayPal client refuses any host except the sandbox.
- The server rejects a filing that the seller has not confirmed.

## Run it

Needs Node 22.9 or newer.

```bash
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000. With an empty `.env` it runs on fictional cases. The header then shows **Simulated PayPal** and **Scripted hearing**, so it's always clear what is real.

Add a free `GEMINI_API_KEY` from aistudio.google.com/apikey for the AI hearing, and `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a sandbox app for real sandbox disputes. Never commit `.env`.

### Create a sandbox dispute

1. In the PayPal Developer Dashboard, under Testing Tools, Sandbox Accounts, make a United States Business account and a United States Personal account.
2. Under Apps & Credentials, create a sandbox app linked to that Business account, and put its keys in `.env`.
3. Run `npm run orders`. It prints a sandbox payment link for each demo item.
4. Open a link, log in as the Personal account and pay. It returns to localhost.
5. Run `npm run orders -- capture ORDER_ID` to complete the payment.
6. Sign in at sandbox.paypal.com as the buyer and report a problem with that payment.
7. Restart Objection!. The dispute appears in the list.
8. If its status is Open, press **Test step: ask the seller for evidence**.

To show the fictional cases even with keys present, set `USE_SIMULATED_PAYPAL=true`.

## Check your setup

```bash
npm run check
```

This signs in to the sandbox, lists disputes and runs one hearing. It changes nothing at PayPal and prints what is left to do.

## Tests

```bash
npm test
```

## Assumptions to confirm

`server/rules.js` holds a $15 Standard Dispute Fee, a 40% partial offer and a 50% acceptance chance. The fee comes from PayPal help content and may vary by country and account. The evidence weights are our judgment, not PayPal data.

This is not legal advice and is not affiliated with PayPal.

## License

MIT
