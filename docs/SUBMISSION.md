# Devpost submission draft

**Name:** Objection!

**Tagline:** Rehearse your PayPal dispute before you answer it.

## Inspiration

Sellers on forums keep describing the same moment: a dispute arrives, a deadline starts, and they can't tell whether the case is winnable. Large merchants have dispute teams. A person selling from a kitchen table has a form.

## What it does

Objection! reads a seller's open disputes from PayPal and shows what evidence that dispute type needs. Two AI advocates argue the case in front of an AI judge, which exposes the weak points. The app then compares the expected cost of fighting, refunding or making a partial offer. The seller reviews the drafted note and files through PayPal.

It will tell a seller not to fight when fighting costs more.

## How we built it

Node and Express with a plain JavaScript front end and AG Grid. The PayPal Disputes API handles listing, reading, evidence, offers and claims, with sandbox `require-evidence` and `adjudicate` to complete test cases. Google Gemini returns the hearing as JSON.

AI doesn't touch the money. Costs and recommendations come from deterministic rules, buyer text is treated as untrusted data, and nothing is filed without the seller's confirmation.

## Challenges

Finding the real problem. Forum reading showed that a better-worded appeal wouldn't help when a dispute type is mostly lost anyway, so we built a decision tool, not an appeal writer.

## What's next

Talk to real sellers, connect shipping and store data, and replace our evidence weights with measured outcomes.

## Built with

PayPal Disputes API, PayPal Sandbox, Google Gemini API, Node.js, Express, AG Grid

## AI tools disclosure

Google Gemini powers the hearing and the draft note. Claude Code was used to help write this project.

## Before submitting

Remove any claim that isn't true of the recorded build. Confirm the public repo, MIT license, YouTube link and working demo URL.
