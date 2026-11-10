## Inspiration

A dispute email arrives, a response deadline starts, and a small seller has to decide alone: fight, refund, or offer something in between. Large merchants have dispute teams for this. Someone selling handmade dinner sets from a kitchen table has a form.

We read seller forums and PayPal community threads before building. The pattern was consistent: sellers don't know which evidence matters for which kind of dispute, they can't tell whether a case is winnable, and when they lose, they rarely understand why. "Item not received" cases often turn on tracking. "Not as described" cases are much harder for sellers to win. So the most useful advice is sometimes *don't fight this one*.

## What it does

Objection! reads a seller's open disputes from PayPal and walks them through four steps:

1. **Evidence locker.** A checklist built for that dispute type, with a case strength score. A digital download needs access logs, not tracking.
2. **Practice hearing.** One AI argues for the buyer as strongly as the facts allow, another defends the seller, and an AI judge tests both. The seller sees their weakest point before PayPal does, and gets a drafted note.
3. **What each choice costs.** Fight, refund, or a partial offer, each with an expected cost that includes dispute fees. On a weak $48 case it recommends a partial refund, not a fight.
4. **Review and file.** The seller edits the note and files evidence, makes an offer, or asks PayPal to review, all through the PayPal Disputes API. Nothing is sent until they press File.

## How we built it

- **PayPal Disputes API (sandbox):** list and read disputes, provide evidence (multipart, as PayPal documents), make offers, accept claims, escalate, plus sandbox-only actions to set up test cases.
- **PayPal Orders API:** a helper script creates and captures sandbox orders so we can open real test disputes as a buyer.
- **Google Gemini API:** runs the hearing and returns structured JSON. If a model is busy, it falls back to a lighter one. With no key, the app shows a clearly labelled scripted hearing.
- **Node.js and Express**, a plain JavaScript front end, and **AG Grid** for the dispute list.
- 25 automated tests, plus a read-only `npm run check` that confirms the PayPal and Gemini connections.

## Built to be trusted

- **AI argues, rules decide money.** Dollar figures and the recommendation come from deterministic code, never from the model.
- **The buyer's words are treated as data.** They're fenced in the prompt, so a message saying "ignore your rules" is just evidence.
- **Honest estimates.** The win chance is capped at 90% and labelled as our estimate. The app follows what each dispute allows, using the actions and offer types PayPal returns.
- **Sandbox only and seller-confirmed.** The client refuses any PayPal host but the sandbox, and the server rejects a filing the seller hasn't confirmed.

## Challenges

The real sandbox taught us things our simulation couldn't. PayPal rejected several evidence entries without item IDs, only allowed plain refunds on some disputes, and after an inquiry response the case returned to the buyer until escalated. We fixed each one by testing against real sandbox disputes, and the app now reads PayPal's allowed actions instead of assuming them.

## What we learned

The best decision tool isn't the one that always says "fight". A seller saved from a losing $15 dispute fee is helped as much as one who wins.

## What's next

Talk to real sellers, pull tracking and order data in automatically, and replace our evidence weights with measured outcomes. This is not legal advice and is not affiliated with PayPal.

## Try it

- **Live demo:** https://objection-7zpy.onrender.com (fictional cases labelled Simulated PayPal, with real Gemini hearings; the free server can take about a minute to wake up)
- **Code:** https://github.com/doppleganger11/objection
