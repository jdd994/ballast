// AddExpense.tsx
// Snap the receipt, say what it was.
//
// The capture calls `readReceipt()`, which today returns nothing — so the fields
// open blank and you type. That call is not dead code: it is the seam. The day a
// good on-device receipt model is cheap, `receipt.ts` starts returning values and
// this component pre-fills itself without a single line changing here.
//
// The categoriser suggests as you type the merchant, and says honestly whether it
// LEARNED that from you or is merely guessing. Confirming a guess teaches it.

import { useEffect, useRef, useState } from "react";
import { parseMoney } from "../lib/money";
import { CATEGORIES, SPEND_CATEGORIES, type Category, type Suggestion } from "../lib/categorize";
import type { TransactionContent } from "../lib/spend";
import { readReceipt } from "../lib/receipt";
import { compressImage, dataUrl } from "../lib/media";
import type { Account } from "../lib/ledger";
import { TrustBadge } from "./TrustBadge";
import { Receipt } from "./icons";

function today(): string {
  return dateKey(new Date());
}

function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The form takes a date, but a transaction is stored at an instant. For a past
// date, noon is a fair, timezone-safe stand-in for "some time that day".
//
// For TODAY, though, use the actual clock. Stamping an expense you just logged at
// 8pm as if it happened at noon is simply untrue, and it bites: a goal started
// this afternoon would silently exclude a receipt you entered this evening,
// because the expense would sit before the goal's own start line.
function instantFor(date: string): number {
  const now = new Date();
  if (date === dateKey(now)) return now.getTime();
  return new Date(`${date}T12:00:00`).getTime();
}

export function AddExpense({
  currency,
  accounts,
  busy,
  suggest,
  onAdd,
  onClose,
}: {
  currency: string;
  accounts: Account[];
  busy: boolean;
  suggest: (merchant: string) => Suggestion | null;
  onAdd: (content: TransactionContent, at: number, receipt?: File) => Promise<void>;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string>("");
  const [note, setNote] = useState("");
  const [income, setIncome] = useState(false);

  const [receipt, setReceipt] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whether the current category came from the user or from the categoriser, so
  // we never overwrite a deliberate choice with a suggestion.
  const [touchedCategory, setTouchedCategory] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Suggest a category from the merchant as it's typed.
  useEffect(() => {
    if (income) return;
    const s = merchant.trim() ? suggest(merchant) : null;
    setSuggestion(s);
    if (s && !touchedCategory) setCategory(s.category);
  }, [merchant, income, suggest, touchedCategory]);

  async function pickReceipt(file: File) {
    setError(null);
    setReading(true);
    try {
      // Downscale first, then preview — so what you see is what gets stored.
      const { bytes, type } = await compressImage(file);
      setPreview(dataUrl(bytes, type));
      setReceipt(file);

      // The seam. Empty today; the UI is already built to use whatever it
      // eventually returns.
      const draft = await readReceipt(new Blob([bytes], { type }), currency);
      if (draft.merchant) setMerchant(draft.merchant);
      if (draft.amount) setAmount(String(Math.abs(draft.amount.minor) / 100));
      if (draft.at) setDate(new Date(draft.at).toISOString().slice(0, 10));
    } catch (e) {
      // A photo that can't be read must never block logging the expense. The
      // number is the thing that matters; the picture is a nice-to-have.
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
      setReceipt(null);
      setPreview(null);
    } finally {
      setReading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = parseMoney(amount, currency);
    if (!parsed || parsed.minor === 0) {
      setError("How much was it?");
      return;
    }
    if (!merchant.trim()) {
      setError("Who was it? (This is what the categoriser learns from.)");
      return;
    }

    const magnitude = Math.abs(parsed.minor);
    const content: TransactionContent = {
      // Money out is negative. Signed at the boundary, so nothing downstream has
      // to remember a convention.
      amount: { minor: income ? magnitude : -magnitude, currency },
      merchant: merchant.trim(),
      category: income ? "income" : category,
      note: note.trim() || undefined,
      accountId: accountId || undefined,
    };

    try {
      await onAdd(content, instantFor(date), receipt ?? undefined);
      onClose();
    } catch {
      // useLedger surfaced the reason; keep the sheet open so nothing typed is lost.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{income ? "Log income" : "Log an expense"}</h3>

        {/* The receipt is a tier-0 artifact and it says so, because a photo of
            your receipt is more revealing than the number on it. */}
        <div className="receipt-zone">
          {preview ? (
            <div className="receipt-preview">
              <img src={preview} alt="Receipt" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setReceipt(null);
                  setPreview(null);
                }}
              >
                Remove photo
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="receipt-drop"
              onClick={() => fileInput.current?.click()}
              disabled={reading}
            >
              <span className="receipt-icon" aria-hidden="true">
                <Receipt size={24} />
              </span>
              <span>
                {reading ? "Reading…" : "Photograph the receipt"}
                <small>
                  <TrustBadge tier={0} /> encrypted on this device, never uploaded
                </small>
              </span>
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickReceipt(f);
              e.target.value = "";
            }}
          />
        </div>

        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}

          <div className="row">
            <label className="field">
              <span className="label">{income ? "Amount in" : "Amount"}</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </label>
            <label className="field">
              <span className="label">When</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span className="label">{income ? "From" : "Who"}</span>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder={income ? "Acme Payroll" : "Trader Joe's"}
            />
            {suggestion && !income ? (
              <span className="hint">
                {suggestion.from === "learned" ? (
                  <>
                    You've filed this under{" "}
                    <strong>{CATEGORIES[suggestion.category].label}</strong> before.
                  </>
                ) : (
                  <>
                    Guessing <strong>{CATEGORIES[suggestion.category].label}</strong> — correct it
                    and it'll remember.
                  </>
                )}
              </span>
            ) : null}
          </label>

          {!income ? (
            <label className="field">
              <span className="label">Category</span>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as Category);
                  setTouchedCategory(true);
                }}
              >
                {SPEND_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].label}
                  </option>
                ))}
                <option value="transfer">{CATEGORIES.transfer.label} (not spending)</option>
              </select>
            </label>
          ) : null}

          {accounts.length > 0 ? (
            <label className="field">
              <span className="label">Which account? (optional)</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field">
            <span className="label">Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was it for?"
            />
          </label>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setIncome((v) => !v)}
          >
            {income ? "← This is an expense" : "This is income instead →"}
          </button>

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || reading}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
