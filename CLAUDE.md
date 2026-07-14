# CLAUDE.md — Ballast

Context for Claude Code working in this repo. Read this first.

Sibling to **Driftless** (`../driftless`), and it shares that project's spine:
local-first, end-to-end encrypted, no analytics, no extraction. Where Driftless
catches your thoughts, Ballast steadies your money. Where the two overlap
technically (crypto, IndexedDB, PWA shell, biometric unlock, sync), prefer to
port Driftless's proven code over inventing a second version of it.

## What this is

A financial wellbeing dashboard built around one job: **show you the truth about
your money, calmly, and help you see whether you're getting where you want to
go.** It is local-first and end-to-end encrypted. Sync is the main open chapter.

## Purpose (the north star)

**The north star is gratitude and helping people.**

Not growth, not engagement, not revenue, not even privacy — privacy is a means,
not the end. Ballast exists to *actually make someone's life better*, and to be
grateful that they let it try. Everything else in this document is downstream of
that sentence, and if a decision ever seems to conflict with it, that sentence
wins.

Two practical consequences, because a north star that doesn't change decisions
isn't one:

- **Helping people is measured by whether their life is better, not by whether
  they came back.** A person who opens Ballast, sees clearly, feels steadier, and
  then doesn't need it for three months is a *success*. Never optimise for
  retention. An app that needed you to keep coming back would start doing the
  things that make people keep coming back, and those things are all bad.
- **Gratitude points outward.** The user gave us their attention and their trust
  with the most sensitive data they have. That debt is already settled by them
  showing up. Anything they give back is a bonus on top — never an expectation,
  never a nag, never a thing withheld until they do. See `Support.tsx`.

This is Driftless's *"love is the point"* wearing work clothes. Same star.

It also explains the shape of everything below. Personal finance software has a
default business model: get access to your transaction data, then sell you
products — a card, a loan, a robo-advisor — and take a referral fee. Every
"insight" in that world is an advertisement wearing a lab coat. That business
model cannot coexist with gratitude and helping people, so Ballast inverts it,
the way Driftless inverts social media:

- **Awareness over advice.** Show people their own money clearly. Clarity is the
  product. The app never recommends a financial product, ever.
- **Confidence over shame.** Being underwater is a fact, not a verdict. No
  alarm-red dashboards, no streaks, no nagging, no gamified guilt. Shame is not
  a financial planning tool, and a person who feels bad opens the app less.
- **You name the target; we tell you the truth.** A goal is *yours*. Ballast only
  answers, honestly, whether your real behaviour gets you there.
- **No scoreboard.** No comparison to "people like you", no credit-score theatre,
  no engagement hooks.

Filter every feature through: *does this deepen the user's understanding of their
own situation, or does it sneak in a product recommendation, a comparison, or an
extraction?* If the latter, don't build it — no matter how normal it is for a
finance app. **Never** add affiliate links, referral fees, product
recommendations, ads, analytics, or engagement mechanics.

### The line on "suggest alternatives"

The user's original brief mentioned suggesting cheaper alternatives to what you
spend on. We deliberately did **not** build that, because it is the exact seam
where every finance app turns into an affiliate machine. What we build instead:

- ✅ "These 3 subscriptions total $47/mo." — a true fact about your own data.
- ✅ "Your normal spending already clears the $4,000 bonus threshold; you don't
  need to change anything." — travel hacking as pure self-awareness.
- ❌ "Get the Chase Sapphire." — never. Not even unpaid. Not even as a favour.

The rule: **the user names the product and the target; Ballast only ever reports
on their own trajectory.**

## Design intent (don't flatten this)

- The feeling is **deep water at dusk**: green-black, still, weighty, calm. You
  should be able to open this at 3am after a bad day and not flinch.
- Explicitly **not** the fintech idiom. No trading-terminal red/green, no rocket
  ships, no confetti, no urgency. Tokens live in `src/styles.css`.
- The **waterline** is the signature element: your net worth against a brass rule
  at zero. Above it you're afloat; below it you're underwater and the app says so
  plainly, once, without cruelty.
- Fonts are **system-native on purpose** — no font CDN, so `font-src 'self'` in
  the CSP stays absolute with no third-party exception. Tabular numerals
  everywhere numbers live.

## Stack

- Vite + React 18 + TypeScript, `idb` for IndexedDB, WebCrypto (AES-GCM +
  PBKDF2), `vite-plugin-pwa`. Vitest for the money math.
- No crypto dependencies. No UI framework. No analytics. Ever.

## Architecture

- `src/lib/crypto.ts` — passphrase → AES-GCM key; `sealJSON`/`openJSON` are the
  only doors between plaintext domain objects and stored ciphertext. Identity
  keypair (ECDH P-256) exists from day one but is unused — retrofitting identity
  after sync ships is painful (Driftless learned this; see its SYNC_PLAN.md).
- `src/lib/db.ts` — IndexedDB. Stores: `vault`, `accounts`, `snapshots`,
  `transactions`, `media`, `goals`, `sync`, `device`. Every record is
  `{ id, createdAt, updatedAt, deleted, dirty, content: CipherBlob }` — plaintext
  bookkeeping, encrypted everything-else.
- `src/lib/money.ts` — **pure.** Exact integer-minor-unit money, quantities, net
  worth, goal projection. Unit-tested. Add logic here by preference.
- `src/lib/ledger.ts` — **pure.** Domain types + valuation + the trust ladder.
- `src/lib/spend.ts` — **pure.** Spending windows, category totals, comparisons.
- `src/lib/categorize.ts` — **pure.** The local learning categoriser.
- `src/lib/sources/*` — connectors. Each declares its **trust tier**.
- `src/lib/receipt.ts` — the OCR seam. Today's reader returns nothing.
- `src/hooks/useLedger.ts` — the ONLY place state, IO, and the key meet.
- `src/components/*` — presentational; data and callbacks in, nothing else.

### The trust ladder

Every account wears a badge saying what it cost to connect it. This is a
**property of the data model**, rendered next to the account forever — not a
disclosure buried in a policy.

| Tier | Source | Who learns what |
|---|---|---|
| 0 | Manual entry, receipts, file import | **Nobody.** |
| 1 | Public chain data, market prices | A provider learns *which* asset/address — never how much. |
| 2 | Read-only API keys (brokerage/exchange) | The institution that already has your data. Nobody new. |
| 3 | Aggregator (Plaid/Teller/SimpleFIN) | **Every transaction, in the clear.** Not built. |

Adding a `connect-src` host to `public/_headers` is a **security decision**, not a
config tweak. The CSP is the ladder, enforced by the browser.

If tier 3 is ever built: look hard at **SimpleFIN** before Plaid — smaller, more
user-aligned. And it must look exactly as alarming as it is.

### Invariants — please preserve

1. Plaintext must never reach storage, logs, or the network. Only ciphertext
   leaves memory. Everything goes through `sealJSON`/`openJSON`.
2. The key stays in memory only — a **ref** in `useLedger`, never React state
   (state leaks into devtools and error payloads), never persisted. The one
   exception is the biometric wrap, which is device-local and never synced.
3. **Money is never a float.** Integer minor units, always. A dashboard that's
   off by a cent is one you stop trusting. Asset quantities are integer strings
   in base units (wei overflows float64 entirely). The single sanctioned float
   conversion is `quantityToFloat`, used only where a quantity meets a price.
4. **An unknown is not a zero.** If a price is missing, the account is reported
   as *unpriced* — never folded into the total as zero. Understating someone's
   net worth while looking plausible is the most dangerous kind of wrong.
5. **Authentication and encryption stay separate.** Same as Driftless invariant 4.
   When sync lands, the account says *whose* ciphertext this is; the passphrase
   *decrypts* it and never leaves the device. Never derive the key from the login
   credential. A server compromise must yield only unreadable ciphertext.
6. **No third party sees a receipt photo.** Ever. See `receipt.ts`.

## Licence

**AGPL-3.0** (same as Driftless). The licence is load-bearing, not a formality: a
permissive licence would explicitly allow the thing this project exists to refuse
— a fork with affiliate links, run as a closed service. Do not change it to MIT.

## Conventions

- TypeScript strict is on. Keep it green.
- Pure logic → `lib/`. State/IO → the hook. Components stay presentational.
- Copy is plain, calm, second person. Errors say what happened and what to do.
  Never scold the user about their money.

## Commands

```bash
npm run dev      # local dev server (PWA enabled for install testing)
npm run build    # tsc -b && vite build
npm run test     # vitest — the money math
npm run preview  # serve the built app
```

## Roadmap

1. **Spend tracking** — transactions, encrypted receipt photos, the local
   learning categoriser. (In progress.)
2. **Sync.** Port Driftless's model wholesale: a tiny custom server (Cloudflare
   Workers + D1) that stores opaque ciphertext; devices reconcile by
   `updatedAt`. Records already carry `deleted` + `dirty`. Identity keys are
   already in the vault.
3. **Tier 2 connectors** — read-only brokerage/exchange API keys. Keys live
   encrypted in the vault; the browser calls the institution directly.
4. **Receipt OCR** — only when a good on-device model is cheap. The seam is
   already in `receipt.ts`; swapping the reader changes one file and zero UI.
   **Never** cloud OCR.
5. **Encrypt timestamps.** Today `at` is plaintext so sorting is cheap. Same
   explicit decision Driftless deferred. Revisit with sync.
6. Niceties: CSV/OFX import (tier 0!), FX for multi-currency (explicit, dated,
   visible conversions — never an invisible rate), net-worth chart.

## Watch out for

- StrictMode double-invokes effects in dev — keep effects idempotent.
- IndexedDB is async; the hook updates memory optimistically then persists. Keep
  that order.
- **HEIC.** iPhone photos are HEIC and desktop browsers can't decode them.
  Driftless tried a WASM converter and **deleted it** (`0ae3a1c`) in favour of
  native decode plus a clear error message. Don't re-add it. `media.ts` carries
  that lesson forward.
- Don't add analytics or any third-party script that could see financial data.
