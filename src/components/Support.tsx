// Support.tsx
// The tip jar, and the honest answer to "so how does this survive?"
//
// Every other finance app has an obvious answer to that question: it gets paid a
// referral fee when you take out the card it recommended. Ballast refuses that
// money on purpose (see CLAUDE.md), which means it has no revenue at all unless
// someone chooses to give it some.
//
// Two things make this different from Driftless's tip jar, and both matter:
//
//   1. **The people using this app may be broke.** That is not a hypothetical —
//      it is arguably the core user. A finance app that makes someone feel bad
//      for not tipping is doing the exact thing the app exists to refuse. So the
//      copy says, plainly and first, that if money is tight they should keep it.
//      Shame is not a financial planning tool, and that rule doesn't get
//      suspended when it's our own hand out.
//
//   2. **No payment processor, no widget, no script.** Copyable addresses and one
//      outbound link. Nothing here can see your finances, nothing loads a
//      third-party script, and no CSP exception was carved to make it work — a
//      plain <a href> is navigation, not a connection.

import { useEffect, useState } from "react";
import { TrustBadge } from "./TrustBadge";

// Copyable text and a link. No processor, no tracker, no CSP change.
const SUPPORT = {
  btc: "bc1qvhzyyhjngwyc02p5ska0pk33tvn6dnq06vacgv", // device-verified on Trezor
  eth: "0x6857f91F7Fcd7B45a3ab3A51D2CdC47E23FE8c75",
  fiatUrl: "https://ko-fi.com/johnny65449",
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the address is still right there to copy by hand.
    }
  }
  return (
    <div className="support-row">
      <span className="support-label">{label}</span>
      <button className="support-addr" onClick={copy} title={`Copy ${label} address`}>
        <span className="support-addr-text">{value}</span>
        <span className="support-copy">{copied ? "copied ✓" : "copy"}</span>
      </button>
    </div>
  );
}

export function Support({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Support Ballast</h3>

        {/* First, before any ask. Someone reading this may be the person who
            needs the app most, and they should not feel got at. */}
        <div className="trade">
          <strong>If money is tight, keep it.</strong> Genuinely. You're using an app about
          getting steady with your money — if you're not there yet, the last thing you need is
          us with our hand out. Ballast is free and stays free, and nothing is withheld from
          you. Come back when you're comfortable, or don't. It's fine either way.
        </div>

        <p>
          Here's the honest version of how this works. Most money apps are free because they
          get paid a referral fee when you take out the card they recommended. That's why the
          "insights" always end in a product.
        </p>
        <p>
          <strong>Ballast refuses that money.</strong> No ads, no affiliate links, no product
          recommendations, no analytics, and nobody buying a look at your spending — because
          nobody <em>can</em> look at it. Which leaves exactly one way for it to keep going:
          people who find it useful, chipping in if they can.
        </p>

        <div className="support-block">
          <CopyRow label="Bitcoin" value={SUPPORT.btc} />
          <CopyRow label="Ethereum" value={SUPPORT.eth} />
          <a
            className="support-fiat"
            href={SUPPORT.fiatUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Prefer a card? Support on Ko-fi →
          </a>
        </div>

        <p className="support-note">
          <TrustBadge tier={0} /> Tipping changes nothing about your privacy. There's no payment
          widget here and no third-party script — just addresses you can copy and a plain link.
          Ballast still can't see your money, and neither can we.
        </p>

        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
