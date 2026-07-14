// IosSetupNote.tsx
// iPhone/iPad only, and only in Safari before the app is installed.
//
// This exists to prevent a genuine data-loss scare, not to nag. On iOS, an app
// added to the Home Screen gets its OWN storage, separate from the Safari tab it
// was added from. So if someone creates their vault in Safari and THEN adds
// Ballast to the Home Screen, the installed app opens with no accounts and a zero
// net worth — and, this being a finance app with no account and no server, their
// honest conclusion is "I've lost all my financial data."
//
// They haven't; it's still in the Safari tab. But that's a horrible thirty
// seconds to put someone through, so we say it plainly and first: on iPhone,
// install BEFORE you set up.
//
// Deliberately a strong, unmissable warning rather than a hard block. Hard-
// blocking a local-first app from running in a browser tab is itself user-
// hostile — some people can't install, or simply want to try it in the browser.
// Autonomy, with the risk made impossible to miss. (Hardening this into a gate,
// if ever wanted, is a one-line change in Welcome.)
//
// Renders nothing on any other platform, or once installed.

import { isIOS, isStandalone } from "./InstallHint";

export function IosSetupNote() {
  if (!isIOS() || isStandalone()) return null;
  return (
    <div className="ios-note">
      <p className="ios-note-title">On iPhone, add to your Home Screen first</p>
      <p className="ios-note-body">
        Tap the <b>Share</b> button (the square with an arrow pointing up, at the bottom of
        Safari), then <b>Add to Home Screen</b>. Open Ballast from that new icon and create your
        vault there.
      </p>
      <p className="ios-note-body">
        This matters: an app added to your Home Screen keeps its own separate storage. If you set
        up here in Safari first, the installed app would start empty — and there's no way to
        recover a vault you can't open. A minute now saves that scare.
      </p>
    </div>
  );
}
