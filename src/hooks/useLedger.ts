// useLedger.ts
// The ONLY place where state and IO meet, and the only place that ever holds the
// decrypted key. Everything else in the app is either pure logic (lib/) or a
// presentational component that receives data and callbacks.
//
// That is not architectural fussiness — it is the mechanism that makes invariant
// #1 auditable. If plaintext can only leave memory through this file, then
// checking that plaintext never reaches disk means reading this one file
// instead of grepping the whole app.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkVerifier,
  deriveKeyFromSalt,
  exportKeyRaw,
  generateIdentityKeypair,
  importKeyRaw,
  makeVerifier,
  newSalt,
  openJSON,
  sealJSON,
  exportPublicKeyB64,
  wrapPrivateKey,
  PBKDF2_ITERATIONS,
} from "../lib/crypto";
import * as db from "../lib/db";
import {
  valueAccounts,
  currentNetWorth,
  netWorthSeries,
  goalCurrentValue,
  type Account,
  type AccountContent,
  type AccountValue,
  type Prices,
  type Snapshot,
  type SnapshotContent,
  type GoalContent,
  type Point,
} from "../lib/ledger";
import { goalProgress, type Goal, type NetWorth, type Progress } from "../lib/money";
import { connectorFor } from "../lib/sources";
import { clearPriceCache, fetchPrices } from "../lib/sources/prices";
import { biometricSupported, enrollBiometric, unlockBiometric } from "../lib/biometric";

export type Status = "loading" | "setup" | "locked" | "unlocked";

export type Ledger = {
  status: Status;
  currency: string;
  error: string | null;
  busy: boolean;

  accounts: Account[];
  snapshots: Snapshot[];
  goals: Goal[];
  prices: Prices;

  // Derived, recomputed on every change. Cheap at any plausible number of
  // accounts, and always consistent with what's on screen.
  valued: AccountValue[];
  net: NetWorth & { unpriced: Account[] };
  series: Point[];
  progressFor: (goal: Goal) => Progress;

  canBiometric: boolean;
  hasBiometric: boolean;

  setup: (passphrase: string, currency: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  enableBiometric: () => Promise<boolean>;
  lock: () => void;

  addAccount: (content: AccountContent, initial?: SnapshotContent) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  recordSnapshot: (accountId: string, content: SnapshotContent) => Promise<void>;
  refreshAccount: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;

  addGoal: (content: GoalContent) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
};

const uid = () => crypto.randomUUID();

export function useLedger(): Ledger {
  // The key. In a ref, never in state, never persisted. React state can end up
  // in devtools and in error-boundary payloads; a ref stays put.
  const keyRef = useRef<CryptoKey | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [prices, setPrices] = useState<Prices>({});

  const [canBiometric, setCanBiometric] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);

  // Is there a vault on this device yet? Effects are idempotent so StrictMode's
  // double-invoke in dev is harmless.
  useEffect(() => {
    (async () => {
      const [vault, device, supported] = await Promise.all([
        db.getVault(),
        db.getDevice(),
        biometricSupported(),
      ]);
      setCanBiometric(supported);
      setHasBiometric(!!device);
      if (vault) {
        setCurrency(vault.currency);
        setStatus("locked");
      } else {
        setStatus("setup");
      }
    })();
  }, []);

  // ---- decrypt everything into memory ------------------------------------

  const loadAll = useCallback(async (key: CryptoKey) => {
    const [sa, ss, sg] = await Promise.all([
      db.allStoredAccounts(),
      db.allStoredSnapshots(),
      db.allStoredGoals(),
    ]);

    const acc = await Promise.all(
      sa
        .filter((r) => !r.deleted)
        .map(async (r): Promise<Account> => {
          const c = await openJSON<AccountContent>(key, r.content);
          return { ...c, id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt };
        })
    );
    const snaps = await Promise.all(
      ss
        .filter((r) => !r.deleted)
        .map(async (r): Promise<Snapshot> => {
          const c = await openJSON<SnapshotContent>(key, r.content);
          return { ...c, id: r.id, accountId: r.accountId, at: r.at };
        })
    );
    const gl = await Promise.all(
      sg
        .filter((r) => !r.deleted)
        .map(async (r): Promise<Goal> => {
          const c = await openJSON<GoalContent>(key, r.content);
          return { ...c, id: r.id };
        })
    );

    setAccounts(acc);
    setSnapshots(snaps);
    setGoals(gl);
    return { acc, snaps };
  }, []);

  // Prices are public data, so this is safe to do on any set of holdings. It
  // reveals which symbols, never how many. See sources/prices.ts.
  const loadPrices = useCallback(
    async (snaps: Snapshot[], cur: string) => {
      const symbols = snaps
        .filter((s): s is Snapshot & { type: "holding" } => s.type === "holding")
        .map((s) => s.quantity.symbol);
      if (symbols.length === 0) return;
      try {
        setPrices(await fetchPrices(symbols, cur));
      } catch (e) {
        // A missing price is not a zero balance. Say so, and let the affected
        // accounts render as unpriced rather than silently as worthless.
        setError(e instanceof Error ? e.message : "Couldn't reach the price feed.");
      }
    },
    []
  );

  // ---- setup / unlock / lock ---------------------------------------------

  const setup = useCallback(async (passphrase: string, cur: string) => {
    setBusy(true);
    setError(null);
    try {
      const salt = newSalt();
      const key = await deriveKeyFromSalt(passphrase, salt, PBKDF2_ITERATIONS);

      // Identity keypair from day one. Nothing uses it yet — see crypto.ts for
      // why it exists anyway.
      const kp = await generateIdentityKeypair();

      await db.saveVault({
        id: "vault",
        salt,
        verifier: await makeVerifier(key),
        createdAt: Date.now(),
        iterations: PBKDF2_ITERATIONS,
        currency: cur,
        identityPublic: await exportPublicKeyB64(kp.publicKey),
        identityPrivate: await wrapPrivateKey(key, kp.privateKey),
      });

      keyRef.current = key;
      setCurrency(cur);
      setStatus("unlocked");
    } finally {
      setBusy(false);
    }
  }, []);

  const finishUnlock = useCallback(
    async (key: CryptoKey, cur: string) => {
      keyRef.current = key;
      const { snaps } = await loadAll(key);
      setStatus("unlocked");
      void loadPrices(snaps, cur);
    },
    [loadAll, loadPrices]
  );

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const vault = await db.getVault();
        if (!vault) return false;
        const key = await deriveKeyFromSalt(passphrase, vault.salt, vault.iterations);
        if (!(await checkVerifier(key, vault.verifier))) {
          setError("That passphrase doesn't open this vault.");
          return false;
        }
        await finishUnlock(key, vault.currency);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [finishUnlock]
  );

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    setError(null);
    const [vault, device] = await Promise.all([db.getVault(), db.getDevice()]);
    if (!vault || !device) return false;
    const raw = await unlockBiometric(device);
    if (!raw) {
      setError("Couldn't unlock with biometrics. Use your passphrase.");
      return false;
    }
    const key = await importKeyRaw(raw);
    if (!(await checkVerifier(key, vault.verifier))) {
      // The stored wrap no longer matches this vault. Drop it rather than
      // leaving a broken shortcut in place.
      await db.clearDevice();
      setHasBiometric(false);
      setError("This device's quick unlock is out of date. Use your passphrase.");
      return false;
    }
    await finishUnlock(key, vault.currency);
    return true;
  }, [finishUnlock]);

  const enableBiometric = useCallback(async (): Promise<boolean> => {
    const key = keyRef.current;
    if (!key) return false;
    const enrollment = await enrollBiometric(await exportKeyRaw(key));
    if (!enrollment) {
      setError("This device can't do biometric unlock.");
      return false;
    }
    await db.saveDevice({ id: "device", ...enrollment });
    setHasBiometric(true);
    return true;
  }, []);

  const lock = useCallback(() => {
    // Drop the key and everything derived from it. After this the process holds
    // no plaintext about the user's money.
    keyRef.current = null;
    setAccounts([]);
    setSnapshots([]);
    setGoals([]);
    setPrices({});
    clearPriceCache();
    setError(null);
    setStatus("locked");
  }, []);

  // ---- writes -------------------------------------------------------------
  // Every write goes: encrypt -> update memory -> persist ciphertext. The order
  // matters. The UI must never wait on IndexedDB to feel responsive, and
  // plaintext must never be handed to a store.

  const recordSnapshot = useCallback(
    async (accountId: string, content: SnapshotContent) => {
      const key = keyRef.current;
      if (!key) return;
      const now = Date.now();
      const snap: Snapshot = { ...content, id: uid(), accountId, at: now };

      setSnapshots((prev) => [...prev, snap]);

      await db.putStoredSnapshot({
        id: snap.id,
        accountId,
        at: now,
        createdAt: now,
        updatedAt: now,
        deleted: false,
        dirty: true,
        content: await sealJSON(key, content),
      });

      if (content.type === "holding") {
        void loadPrices([snap], currency);
      }
    },
    [currency, loadPrices]
  );

  const addAccount = useCallback(
    async (content: AccountContent, initial?: SnapshotContent) => {
      const key = keyRef.current;
      if (!key) return;
      setBusy(true);
      setError(null);
      try {
        const now = Date.now();
        const id = uid();
        const account: Account = { ...content, id, createdAt: now, updatedAt: now };

        setAccounts((prev) => [...prev, account]);
        await db.putStoredAccount({
          id,
          createdAt: now,
          updatedAt: now,
          deleted: false,
          dirty: true,
          content: await sealJSON(key, content),
        });

        // Seed it with whatever we know: the number the user typed, or a live
        // read from the chain.
        let seed = initial;
        if (!seed) {
          const connector = connectorFor(content.source);
          if (connector.read) seed = await connector.read(content.source);
        }
        if (seed) await recordSnapshot(id, seed);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that account.");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [recordSnapshot]
  );

  const removeAccount = useCallback(async (id: string) => {
    const key = keyRef.current;
    if (!key) return;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setSnapshots((prev) => prev.filter((s) => s.accountId !== id));

    // Soft delete: a tombstone, so the removal can propagate to other devices
    // once sync lands. The ciphertext stays; nobody can read it either way.
    const stored = (await db.allStoredAccounts()).find((a) => a.id === id);
    if (stored) {
      await db.putStoredAccount({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    }
    for (const s of await db.snapshotsForAccount(id)) {
      await db.putStoredSnapshot({ ...s, deleted: true, dirty: true, updatedAt: Date.now() });
    }
  }, []);

  const refreshAccount = useCallback(
    async (id: string) => {
      const account = accounts.find((a) => a.id === id);
      if (!account) return;
      const connector = connectorFor(account.source);
      if (!connector.read) return;
      setBusy(true);
      setError(null);
      try {
        await recordSnapshot(id, await connector.read(account.source));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't refresh that account.");
      } finally {
        setBusy(false);
      }
    },
    [accounts, recordSnapshot]
  );

  const refreshAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      for (const a of accounts) {
        const connector = connectorFor(a.source);
        if (!connector.read) continue;
        try {
          await recordSnapshot(a.id, await connector.read(a.source));
        } catch (e) {
          // One dead endpoint must not take down the whole refresh. Report it
          // and carry on with the rest.
          setError(e instanceof Error ? e.message : `Couldn't refresh ${a.name}.`);
        }
      }
      await loadPrices(snapshots, currency);
    } finally {
      setBusy(false);
    }
  }, [accounts, snapshots, currency, recordSnapshot, loadPrices]);

  const addGoal = useCallback(async (content: GoalContent) => {
    const key = keyRef.current;
    if (!key) return;
    const now = Date.now();
    const id = uid();
    setGoals((prev) => [...prev, { ...content, id }]);
    await db.putStoredGoal({
      id,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      dirty: true,
      content: await sealJSON(key, content),
    });
  }, []);

  const removeGoal = useCallback(async (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    const stored = (await db.allStoredGoals()).find((g) => g.id === id);
    if (stored) {
      await db.putStoredGoal({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    }
  }, []);

  // ---- derived ------------------------------------------------------------

  const valued = valueAccounts(accounts, snapshots, prices);
  const net = currentNetWorth(valued, currency);
  const series = netWorthSeries(accounts, snapshots, prices, currency);

  const progressFor = useCallback(
    (goal: Goal): Progress =>
      goalProgress(goal, goalCurrentValue(goal, valued, currency), Date.now()),
    [valued, currency]
  );

  return {
    status,
    currency,
    error,
    busy,
    accounts,
    snapshots,
    goals,
    prices,
    valued,
    net,
    series,
    progressFor,
    canBiometric,
    hasBiometric,
    setup,
    unlock,
    unlockWithBiometric,
    enableBiometric,
    lock,
    addAccount,
    removeAccount,
    recordSnapshot,
    refreshAccount,
    refreshAll,
    addGoal,
    removeGoal,
  };
}
