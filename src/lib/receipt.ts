// receipt.ts
// The seam where receipt reading will one day plug in — and, today, doesn't.
//
// ## Why this file exists while doing nothing
//
// Reading a receipt photo automatically is genuinely desirable: snap it, and the
// amount, merchant and date fill themselves in. The reason Ballast doesn't do it
// yet is not laziness, it's that every option available right now costs more than
// it's worth:
//
//   - **Cloud OCR** (Google Vision, AWS Textract) is accurate and completely
//     unacceptable. It means uploading a photograph of your receipt — merchant,
//     line items, timestamp, often the last four digits of your card — to a third
//     party in the clear. That is a worse deal than the tier-3 aggregator rung,
//     because at least an aggregator is a regulated financial institution. This
//     is forbidden by invariant #6 and is not a trade-off we will revisit.
//
//   - **On-device OCR today** (Tesseract.js) keeps the data private, which is the
//     part that matters, but it is a multi-megabyte WASM engine that is honestly
//     mediocre at real receipts — thermal print, curl, glare, faded ink. Driftless
//     already ran this experiment in a different guise: it added a WASM HEIC
//     converter and then deleted it (commit 0ae3a1c) once the weight stopped
//     justifying the result. We are not repeating that lesson.
//
// So today: the photo IS the record, and you type the amount. That takes about
// eight seconds, it is never wrong, and it works on the first day.
//
// ## What happens when this changes
//
// On-device receipt models are getting rapidly smaller and better. When a good
// one is cheap — a compact vision model in WASM/WebGPU, or a native browser text
// API worth having — this becomes real, and the ONLY thing that changes is this
// file. Write a `ReceiptReader`, set it as the active one, and:
//
//   - `AddExpense` already calls `readReceipt()` and pre-fills whatever comes
//     back, so the UI does not change at all.
//   - Every field stays editable and the user still confirms, so a bad read is a
//     nuisance rather than a corrupted ledger.
//   - The categoriser (categorize.ts) already turns a merchant string into a
//     category, so OCR only ever has to produce the string — the smart part is
//     already built and already learning.
//
// The one rule that must survive that change: **the image never leaves the
// device.** A `ReceiptReader` that makes a network call is not a valid
// implementation of this interface, and the CSP in public/_headers will stop it
// at the browser regardless of what the code says.

import type { Money } from "./money";

// What a reader can offer. Everything is optional — a partial read is useful, and
// a reader that only manages to find the total has still saved you the fiddliest
// bit of typing.
export type ReceiptDraft = {
  amount?: Money;
  merchant?: string;
  at?: number;
};

export type ReceiptReader = {
  name: string;
  // Whether this reader can run here and now (model downloaded, WebGPU present…).
  available: () => Promise<boolean>;
  // Must be pure-local. See the note above.
  read: (image: Blob, currency: string) => Promise<ReceiptDraft>;
};

// Today's reader: honest about knowing nothing.
export const noReader: ReceiptReader = {
  name: "none",
  available: async () => false,
  read: async () => ({}),
};

let active: ReceiptReader = noReader;

// The swap point. One call, one day.
export function setReceiptReader(reader: ReceiptReader): void {
  active = reader;
}

export function activeReader(): ReceiptReader {
  return active;
}

// Called by the capture flow. Returns an empty draft today, which means the form
// simply opens blank and the user types — exactly as if this call weren't here.
// That's the point: the seam is already load-bearing, so the day it starts
// returning real values, nothing downstream needs to be rewritten.
export async function readReceipt(image: Blob, currency: string): Promise<ReceiptDraft> {
  try {
    if (!(await active.available())) return {};
    return await active.read(image, currency);
  } catch {
    // A failed read must never block logging an expense. Fall back to the thing
    // that always works: the human types the number.
    return {};
  }
}
