// Support.tsx
// A DISCLOSURE that happens to contain a tip jar. Not an appeal.
//
// The distinction is the whole design of this file, so it's worth being explicit
// about, because the obvious version of this screen is subtly manipulative and it
// would be easy to write by accident (the first draft of this file did):
//
//   ✗ "This is only kept alive by people like you chipping in."
//
// That is the public-radio pledge drive. It implies that not tipping kills the
// thing, which manufactures an obligation — and it isn't even true. Ballast is a
// static page that runs on the user's own device. Hosting is free. There is no
// company, no salary, no runway. **Nothing is at stake**, and saying so plainly
// is what removes the pressure.
//
// So this screen's job is to answer "how is this paid for, and what's the catch?"
// — a question a person is right to ask of any free finance app. The jar sits at
// the bottom of the answer. It is not the point of the screen.
//
// Two rules for anything ever added here:
//
//   1. **Never create an expectation.** No "help us keep going", no funding goal,
//      no thermometer, no counter, no "X people have supported", no perks, no
//      nag, no reminder, no badge for tippers. Nothing is withheld from anyone,
//      ever. And the people using this app may well be broke — that is arguably
//      the core user. An app whose stated rule is that shame is not a financial
//      planning tool does not get to suspend that rule when it's our own hand
//      out.
//
//   2. **No payment processor, no widget, no script.** Copyable addresses and one
//      outbound link. Nothing here can see your finances, nothing loads a
//      third-party script, and no CSP exception was carved to make it work — a
//      plain <a href> is navigation, not a connection.

import { useEffect, useState } from "react";
import { TrustBadge } from "./TrustBadge";

// A card link (Ko-fi, PayPal underneath) and copyable crypto addresses. No
// processor or widget lives in the app itself — Ko-fi is a plain outbound link,
// so there's no third-party script and no CSP change. The card option leads
// because it's the welcoming front door for most people; crypto is the quiet
// zero-paperwork alternative. Add more addresses by extending `crypto` — one line.
const SUPPORT = {
  fiatUrl: "https://ko-fi.com/johnny65449", // card / PayPal, via Ko-fi
  crypto: [
    { label: "Bitcoin", value: "bc1qvhzyyhjngwyc02p5ska0pk33tvn6dnq06vacgv" }, // device-verified on Trezor
    { label: "Ethereum", value: "0x6857f91F7Fcd7B45a3ab3A51D2CdC47E23FE8c75" },
  ],
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
        {/* A disclosure, not an appeal. The heading matters: "Support Ballast" is
            an ask before you've read a word. This is the question a person is
            right to have about any free finance app. */}
        <h3>Thank you for using it</h3>

        {/* The gratitude points OUTWARD. That's the north star, and it's why this
            screen opens by thanking the user rather than by asking them for
            anything. Somebody sitting down to look honestly at their money — and
            trusting this thing to help them do it — is the whole reason it exists.
            Anything they give back is a bonus on top of a debt already settled. */}
        <p>
          Really. Sitting down to look honestly at your own money takes something, and choosing
          to trust this to help you do it is not nothing. That's the entire reason Ballast was
          built, and you doing it is the thanks.
        </p>

        <h4 className="support-sub">How it's paid for</h4>

        <p>
          It isn't, really — and that's rather the point. There's no company here, no
          investors, and no salary. Ballast is a static page that runs entirely on your device,
          so keeping it online costs close to nothing.
        </p>
        <p>
          Which is worth saying plainly: <strong>nothing is at stake.</strong> There's no
          runway, no funding goal, nothing to rescue. If nobody ever gives a penny, Ballast
          carries on exactly as it is, free, with nothing held back from anyone.
        </p>
        <p>
          The reason it has no income is deliberate. Most money apps are free because they take
          a referral fee when you open the card they recommended — which is why the "insights"
          always end in a product. <strong>Ballast refuses that money:</strong> no ads, no
          affiliate links, no product recommendations, no analytics, and nobody buying a look at
          your spending, because nobody <em>can</em> look at it.
        </p>

        <div className="support-block">
          {/* The jar. Deliberately below the answer, not above it. */}
          <p className="support-intro">
            There's a jar, if you ever feel like it. It's genuinely appreciated — not because
            it's needed, but because it's a kind thing to do, and it makes the next project
            easier to start.
          </p>
          {/* Card first — the front door for most people (Ko-fi, PayPal underneath;
              works from anywhere, in any currency). */}
          <a className="support-card" href={SUPPORT.fiatUrl} target="_blank" rel="noopener noreferrer">
            Leave a tip with a card &nbsp;→
          </a>
          {/* Crypto: the quiet zero-paperwork alternative. */}
          <div className="support-crypto">
            <span className="support-crypto-label">or, if you prefer crypto</span>
            {SUPPORT.crypto.map((c) => (
              <CopyRow key={c.label} label={c.label} value={c.value} />
            ))}
          </div>
        </div>

        {/* Someone reading this may be the person the app is most for. They should
            not feel got at, and they get exactly the same app either way. */}
        <p className="support-note-plain">
          And if money is tight, keep it — genuinely. You'd get nothing extra for giving, and
          nothing is withheld if you don't. This is an app about getting steady with your money;
          if you're not there yet, that's precisely who it was built for.
        </p>

        <p className="support-note">
          <TrustBadge tier={0} /> None of this costs you any privacy. There's no payment widget
          and no third-party script — just addresses you can copy and a plain link. Ballast
          still can't see your money, and neither can we.
        </p>

        {/* Kinship, not a catalog. One quiet line, only here in the maker's
            corner where someone's already curious who built this. These are
            genuinely siblings — same belief, applied to different corners of a
            life — so saying so is telling the truth, not cross-selling. Never a
            banner, never a count, never in the core flow. */}
        <div className="kin">
          <span className="kin-label">Made in the same spirit</span>
          <a href="https://driftless.page" target="_blank" rel="noopener noreferrer">
            Driftless — a quiet place to catch your thoughts →
          </a>
        </div>

        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
