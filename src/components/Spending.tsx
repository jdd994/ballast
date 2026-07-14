// Spending.tsx
// Where the money went, this month.
//
// The tone rule from CLAUDE.md applies hardest here. There is no budget you blew,
// no red bar, no "you're overspending on dining" — that's a judgement, and it
// isn't ours to make. There is what you spent, on what, and whether that's
// unusual for you. What to do about it is yours to decide, and you're better
// placed to decide it than we are.

import { useState } from "react";
import { formatMoney } from "../lib/money";
import { CATEGORIES } from "../lib/categorize";
import {
  byCategory,
  spentIn,
  earnedIn,
  monthWindow,
  notable,
  recurring,
  isSpend,
  type Transaction,
} from "../lib/spend";
import { relative } from "./Waterline";
import { Receipt } from "./icons";

export function Spending({
  transactions,
  currency,
  onRemove,
  onViewReceipt,
}: {
  transactions: Transaction[];
  currency: string;
  onRemove: (id: string) => void;
  onViewReceipt: (mediaId: string) => void;
}) {
  const now = Date.now();
  const w = monthWindow(now);

  const spent = spentIn(transactions, w.from, w.to, currency);
  const earned = earnedIn(transactions, w.from, w.to, currency);
  const cats = byCategory(transactions, w.from, w.to, currency);
  const notices = notable(transactions, now, currency);
  const subs = recurring(transactions, now, currency);

  const thisMonth = transactions
    .filter((t) => t.at >= w.from && t.at < w.to)
    .sort((a, b) => b.at - a.at);

  if (transactions.length === 0) {
    return (
      <div className="empty">
        Nothing logged yet.
        <br />
        Photograph a receipt, or just type what you spent.
      </div>
    );
  }

  return (
    <div>
      <div className="spend-summary">
        <div className="leg">
          <span className="leg-label">Out — {w.label}</span>
          <span className="leg-value is-below">{formatMoney(spent)}</span>
        </div>
        {earned.minor > 0 ? (
          <div className="leg">
            <span className="leg-label">In</span>
            <span className="leg-value is-above">{formatMoney(earned)}</span>
          </div>
        ) : null}
      </div>

      {/* "Unusual for you" — in both directions, because telling someone their
          dining spend halved is the same kind of fact, and it's the one that
          makes them feel capable. */}
      {notices.length > 0 ? (
        <div className="notices">
          {notices.slice(0, 3).map((n) => (
            <div className="notice" key={n.category}>
              {n.ratio > 1 ? (
                <>
                  <strong>{CATEGORIES[n.category].label}</strong> is{" "}
                  <strong>{n.ratio.toFixed(1)}×</strong> your usual month —{" "}
                  {formatMoney(n.this)} against a typical {formatMoney(n.usual)}.
                </>
              ) : (
                <>
                  <strong>{CATEGORIES[n.category].label}</strong> is well down this month —{" "}
                  {formatMoney(n.this)} against a typical {formatMoney(n.usual)}.
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {/* The honest half of "suggest alternatives": these are the charges that
          quietly repeat. What to do about them is entirely your call — Ballast
          does not have an opinion, and would be lying if it pretended to. */}
      {subs.length > 0 ? (
        <div className="section" style={{ marginTop: 24 }}>
          <div className="section-head">
            <h3 className="section-title">Repeating</h3>
            <span className="section-note">
              {formatMoney({
                minor: subs.reduce((a, s) => a + s.amount.minor, 0),
                currency,
              })}{" "}
              a month
            </span>
          </div>
          {subs.map((s) => (
            <div className="repeat" key={s.merchant}>
              <span className="repeat-name">{s.merchant}</span>
              <span className="repeat-meta">{CATEGORIES[s.category].label}</span>
              <span className="repeat-amount money">{formatMoney(s.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {cats.length > 0 ? (
        <div className="section" style={{ marginTop: 24 }}>
          <div className="section-head">
            <h3 className="section-title">Where it went</h3>
          </div>
          {cats.map((c) => (
            <div className="cat" key={c.category}>
              <div className="cat-head">
                <span>{CATEGORIES[c.category].label}</span>
                <span className="money">{formatMoney(c.total)}</span>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${Math.round(c.share * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="section" style={{ marginTop: 24 }}>
        <div className="section-head">
          <h3 className="section-title">{w.label}</h3>
        </div>
        {thisMonth.length === 0 ? (
          <div className="empty">Nothing logged this month.</div>
        ) : (
          thisMonth.map((t) => (
            <Row key={t.id} t={t} onRemove={onRemove} onViewReceipt={onViewReceipt} />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  t,
  onRemove,
  onViewReceipt,
}: {
  t: Transaction;
  onRemove: (id: string) => void;
  onViewReceipt: (mediaId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const out = isSpend(t) || t.amount.minor < 0;

  return (
    <div className="txn">
      <div className="txn-main">
        <div className="txn-merchant">
          {t.merchant}
          {t.receiptId ? (
            <button
              className="receipt-chip"
              onClick={() => onViewReceipt(t.receiptId!)}
              title="View the receipt"
            >
              <Receipt />
            </button>
          ) : null}
        </div>
        <div className="txn-meta">
          <span>{CATEGORIES[t.category].label}</span>
          <span aria-hidden="true">·</span>
          <span>{relative(t.at)}</span>
          {t.note ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{t.note}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className={`txn-amount${out ? " is-below" : " is-above"}`}>
        {formatMoney(t.amount, { sign: true })}
      </div>

      {confirming ? (
        <div className="txn-actions">
          <button className="btn btn-danger btn-sm" onClick={() => onRemove(t.id)}>
            Delete
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
            No
          </button>
        </div>
      ) : (
        <div className="txn-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)} title="Remove">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// The receipt, decrypted only for as long as it's on screen.
export function ReceiptView({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="receipt-full" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Receipt" />
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
