// InstallHint.tsx
// A gentle, dismissible nudge to install Ballast as a real app, shown only when
// it's running in a browser tab (not already installed). Most people don't know
// "add to home screen" exists, so we make it obvious:
//   - Android / desktop Chrome/Edge: capture the native prompt → one-tap Install.
//   - iPhone (Safari): iOS has no programmatic install, so show the exact
//     Share → Add to Home Screen steps.
// Dismissal is remembered so it never nags. Ported from Driftless.
//
// The bigger iOS concern — that installing AFTER setup can leave the app looking
// empty — is handled up front by IosSetupNote on the Welcome screen, because for
// a vault that's a data-loss scare, not a cosmetic nit.

import { useEffect, useState } from "react";

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; the touch check disambiguates.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

type DeferredPrompt = { prompt: () => void; userChoice: Promise<unknown> };
const DISMISS_KEY = "ballast-install-dismissed";

export function InstallHint() {
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [show, setShow] = useState(false);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to do
    if (isIOS()) return; // iOS is guided at setup by IosSetupNote (order matters)
    if (localStorage.getItem(DISMISS_KEY)) return;
    setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as unknown as DeferredPrompt);
    };
    const onInstalled = () => {
      setShow(false);
      localStorage.setItem(DISMISS_KEY, "1");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  async function primary() {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      dismiss();
    } else {
      setSteps((v) => !v);
    }
  }

  return (
    <div className="install-hint">
      <div className="install-row">
        <span className="install-text">
          Add Ballast to your home screen so it opens like an app.
        </span>
        <button className="btn btn-sm install-btn" onClick={primary}>
          {deferred ? "Install" : steps ? "Hide" : "How?"}
        </button>
        <button className="install-x" onClick={dismiss} aria-label="Not now">
          ×
        </button>
      </div>
      {steps && (
        <p className="install-steps">
          Open your browser's menu (the three dots), then choose <b>Install app</b> or{" "}
          <b>Add to Home screen</b>.
        </p>
      )}
    </div>
  );
}
