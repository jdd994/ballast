# Ballast

**Steady footing with your money.**

A financial wellbeing dashboard that is local-first and end-to-end encrypted.
Your balances, accounts, receipts and goals are encrypted on your device before
they are stored anywhere. Not "encrypted in transit" — encrypted so that a breach
of the server yields nothing but noise, and so that we could not read your
finances if we wanted to.

Sibling project to [Driftless](../driftless). Same soul, different job.

---

## What it does

- **The waterline.** One number — your net worth — against a line at zero. Above
  it you're afloat. Below it you're underwater, and the app tells you plainly,
  once, without cruelty.
- **Accounts.** Cash, investments, property, debt, and crypto wallets. Type them
  in, or read a public chain address live.
- **Goals.** "Save $10,000." "Kill this card." "Spend $4,000 to hit a signup
  bonus." All the same question — *given how I'm actually moving, do I get
  there?* — and Ballast answers it honestly, including when the honest answer is
  "not yet enough data to say."
- **Spending.** Photograph a receipt, log what it was, and watch a categoriser
  learn *your* merchants over time — locally, encrypted, never shared.

## What it will never do

No ads. No analytics. No affiliate links. **No product recommendations.**

Most money apps make their money by getting a look at your transactions and then
selling you a card, a loan, or a fund. Every "insight" in that world is an
advertisement wearing a lab coat. Ballast will tell you that three subscriptions
are costing you $47 a month, because that's a true fact about your own money. It
will never tell you which credit card to get, because the moment it does, it has
stopped working for you.

You name the target. Ballast only ever tells you the truth about your trajectory.

## The trust ladder

Every account wears a badge saying exactly what it cost you to connect it, and it
keeps wearing it — on the dashboard, forever.

| | Source | Who learns what |
|---|---|---|
| **Private** | You type it in. Receipts. File imports. | **Nobody.** Not the network, not us. |
| **Public data** | Crypto addresses, market prices. | A provider learns *which* asset you asked about — never how much you hold. |
| **Direct** | Read-only API keys. | The institution that already holds your data. Nobody new. |
| **Third party** | An aggregator like Plaid. | **Every transaction, in the clear.** Not built, and if it ever is, it will look exactly this alarming. |

This isn't a promise in a privacy policy. It's enforced by a Content Security
Policy that lists every host the app is allowed to talk to (`public/_headers`).
If a host isn't on that list, your browser refuses the request.

## The trade

The key comes from your passphrase, and your passphrase never leaves your device.

So **there is no reset**. If you forget it, nobody — not us, not anyone — can
recover your data. Write it down and keep it somewhere safe.

That's the price of the guarantee. We'd rather you hear it now than later.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # the money math
npm run build
```

## How it's built

Vite + React + TypeScript. `idb` for IndexedDB. WebCrypto (AES-GCM, PBKDF2 at
600k iterations) for encryption — no crypto dependencies. A PWA, so it installs
and works offline.

Money is never a floating-point number. It is an exact integer count of minor
units, because a dashboard that's off by a cent is a dashboard you stop trusting.
Asset quantities are integer strings in base units, because one ETH is 10^18 wei
and that doesn't fit in a float.

See [CLAUDE.md](CLAUDE.md) for the architecture and the invariants.

## Licence

**AGPL-3.0**, the same as [Driftless](../driftless).

The licence is doing the same job as the encryption and the Content Security
Policy: making a promise *structural* instead of merely stated.

A permissive licence would explicitly allow the one thing Ballast exists to
refuse — someone forking it, bolting on affiliate links and product
recommendations, running it as a service, and never sharing a line back. The AGPL
closes that door, including the network loophole: if you run a modified Ballast as
a service, you have to publish your changes.

You can use it, run it, fork it, and audit it. You cannot quietly turn it into the
thing it was built to be an alternative to.

## Auditing it

An end-to-end-encrypted app that asks you to trust it, without letting you check,
is asking for something it hasn't earned. The parts worth reading:

- [`src/lib/crypto.ts`](src/lib/crypto.ts) — key derivation and encryption. `sealJSON`/`openJSON` are the
  only doors between plaintext and storage.
- [`src/hooks/useLedger.ts`](src/hooks/useLedger.ts) — the only place the key exists. If plaintext can only
  leave memory through one file, verifying it never reaches disk means reading
  one file.
- [`public/_headers`](public/_headers) — the Content Security Policy. Every host the app is permitted
  to contact, in one line. There is no analytics host, and there never will be.
- [`SECURITY.md`](SECURITY.md) — what's encrypted, what isn't, and what we don't defend against.
