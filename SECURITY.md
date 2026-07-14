# Security

Ballast holds an unusually complete picture of a person's life: what they own,
what they owe, where they shop, and what they're worried about. This document is
what we do about that, and — just as important — what we don't claim.

## The model in one sentence

**The client encrypts; storage and (later) the server hold opaque bytes; the key
is derived from a passphrase that never leaves the device.**

| | What it does | Where it lives |
|---|---|---|
| **Passphrase** | Derives the AES-GCM key that decrypts your data | Nowhere. Never stored, never transmitted. |
| **Vault key** | Encrypts/decrypts everything | Memory only — a `ref` in `useLedger`, for the session |
| **Account** *(when sync lands)* | Says *whose* ciphertext this is | Server stores a password hash; client keeps a token |

These are **two different secrets doing two different jobs**, and they must never
be collapsed. The encryption key is never derived from the login credential, and
the passphrase is never sent anywhere. A total compromise of our server must
yield nothing but unreadable bytes.

## What's encrypted

Everything that says something about you:

- Account names, kinds, and balances
- Wallet addresses
- Transactions: amount, merchant, category, note
- **Receipt photos** — the pixels, not just the metadata
- Goals and targets
- The categoriser's learned merchant memory

Encryption is AES-GCM-256. The key is PBKDF2-SHA256 over the passphrase at
**600,000 iterations** (OWASP's current guidance), with a random 16-byte salt.
The iteration count is stored per-vault, so it can be raised for new vaults
without locking anyone out of an old one.

AES-GCM is authenticated: a wrong key fails loudly rather than producing
plausible garbage, so a bad passphrase can never silently corrupt your ledger.

## What is NOT encrypted, and why

Honest disclosure beats a clean-sounding claim.

- **Record ids, `createdAt` / `updatedAt` / `at` timestamps, tombstones, dirty
  flags.** These are the bookkeeping a sync engine needs to reconcile records it
  cannot read. A future server would learn *that* you recorded something at 14:22
  and that the blob is 400 bytes — never what it was.
- **Your base currency**, so the UI can format numbers before unlock.
- **Your identity public key**, which is public by definition.
- **The image MIME type** (`image/jpeg`) of a receipt. The pixels are ciphertext.

Encrypting timestamps is a real option and a real trade — it makes local sorting
and windowing much more expensive. It is an explicit open decision (see the
roadmap in CLAUDE.md), not an oversight.

## The trust ladder

Every account carries the honest cost of connecting it, rendered next to it in
the UI, permanently.

| Tier | Source | Who learns what |
|---|---|---|
| **0** | Manual entry, receipt photos, file import | **Nobody.** |
| **1** | Public chain data, market prices | A provider learns *which* address or asset you asked about. Never how much, never who you are. |
| **2** | Read-only API keys | The institution that already holds your data. Nobody new. |
| **3** | Aggregator (Plaid, Teller, SimpleFIN) | **Every transaction, in the clear.** *Not built.* |

**The CSP is that ladder, enforced.** `public/_headers` contains an allowlist of
every host the app may contact:

```
connect-src 'self' https://blockstream.info https://cloudflare-eth.com https://api.coingecko.com
```

If a host isn't on that line, the browser refuses the request — including a
request made by a script that got in through a compromised dependency. There is
no analytics host, no font CDN, and no error-reporting service, which is why
`font-src` and `script-src` can stay at a bare `'self'` with no exceptions.

**Adding a host to that line is a security decision, not a config change.**

## Receipt photos never leave the device

There is no OCR service, and there will not be one. Cloud OCR (Google Vision, AWS
Textract) would mean uploading a photograph naming the merchant, the items, the
time, and often the last four digits of your card. That is a worse deal than the
tier-3 aggregator rung — at least an aggregator is a regulated financial
institution.

`src/lib/receipt.ts` defines the seam where an **on-device** reader may plug in
later. Any implementation that makes a network call is invalid, and the CSP would
stop it regardless of what the code claims.

## Biometric unlock

Optional, per-device, built on WebAuthn's PRF extension. A platform passkey emits
a stable secret after a biometric check; that secret wraps a copy of the vault key
**on that device only**. It never syncs and is meaningless elsewhere. The
passphrase remains the durable root — biometrics are a shortcut, never a
replacement.

## There is no recovery

If you forget your passphrase, your data is gone. We cannot reset it, because we
have never had it and cannot derive it. This is not a limitation we intend to fix
— it is the same property that guarantees a breach of our infrastructure exposes
nothing. The app states this before you type a single number.

## What we do not defend against

Claiming otherwise would be dishonest:

- **A compromised device.** Malware or someone with your unlocked laptop can read
  what you can read. Encryption at rest cannot fix an attacker sitting inside the
  session.
- **A malicious dependency shipped in a build.** The CSP sharply limits what such
  code could exfiltrate (it cannot reach an arbitrary host), and we keep the
  dependency tree deliberately tiny — no crypto libraries, no UI framework, no
  analytics — but this is mitigation, not immunity.
- **Traffic analysis at tier 1.** A block explorer sees your IP alongside the
  address you queried. Point the endpoints at your own node to reduce this to
  zero.
- **Someone who already has your passphrase.**

## Reporting

Found something? Open a GitHub issue for anything non-sensitive. For a genuine
vulnerability, email <johndurkin@protonmail.com> rather than filing publicly, and
give us a chance to fix it first.
