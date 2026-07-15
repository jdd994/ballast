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
  generateDEK,
  wrapVaultKey,
  unwrapVaultKey,
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
import type { Transaction, TransactionContent } from "../lib/spend";
import { remember, suggestCategory, type MerchantMemory, type Suggestion } from "../lib/categorize";
import { compressImage, dataUrl } from "../lib/media";
import { encryptBytes, decryptBytes } from "../lib/crypto";
import * as api from "../lib/api";
import { syncNow } from "../lib/sync";

export type Status = "loading" | "setup" | "locked" | "unlocked";

export type Ledger = {
  status: Status;
  currency: string;
  error: string | null;
  busy: boolean;

  accounts: Account[];
  snapshots: Snapshot[];
  transactions: Transaction[];
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

  // Cross-device sync. `account` is the connected email, or null when this vault
  // lives only on this device. The account secret (login) is separate from the
  // passphrase (invariant #5): the server authenticates the account and stores
  // opaque ciphertext; the passphrase decrypts it and never leaves the device.
  account: string | null;
  syncing: boolean;
  syncError: string | null;
  // Connect THIS device's existing vault to a new account (first device).
  connectCreate: (email: string, password: string) => Promise<boolean>;
  // Sign in to an existing account (a second device). Pulls the vault down; the
  // user then unlocks it with the same passphrase.
  connectSignIn: (email: string, password: string) => Promise<boolean>;
  // Stop syncing from this device. Local data stays; nothing is deleted.
  disconnect: () => Promise<void>;
  // Permanently delete the account + all its server blobs. Local data stays.
  deleteAccount: () => Promise<boolean>;
  // Change the vault passphrase (envelope re-wrap; no data re-encryption).
  changePassphrase: (current: string, next: string) => Promise<string | null>;
  // Sync now, on demand (pull others' changes, push ours).
  syncNow: () => Promise<void>;

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

  // Spending. `at` is passed separately because it is plaintext metadata (it
  // indexes the store), not part of the encrypted payload — and because a
  // receipt is usually from yesterday, not from now.
  addTransaction: (content: TransactionContent, at: number, receipt?: File) => Promise<void>;
  removeTransaction: (id: string) => Promise<void>;
  // Decrypt a receipt photo into a data: URL for display. Nothing is cached to
  // disk in the clear — the plaintext image exists only in the open <img>.
  loadReceipt: (mediaId: string) => Promise<string | null>;
  // What the categoriser thinks, and whether it learned it from you or guessed.
  suggest: (merchant: string) => Suggestion | null;
};

const uid = () => crypto.randomUUID();

export function useLedger(): Ledger {
  // The key. In a ref, never in state, never persisted. React state can end up
  // in devtools and in error-boundary payloads; a ref stays put.
  const keyRef = useRef<CryptoKey | null>(null);

  // The sync auth token. Like the key, it lives in a ref, not in React state.
  const tokenRef = useRef<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [prices, setPrices] = useState<Prices>({});
  const [memory, setMemory] = useState<MerchantMemory>({});

  const [canBiometric, setCanBiometric] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);

  // Is there a vault on this device yet? Effects are idempotent so StrictMode's
  // double-invoke in dev is harmless.
  useEffect(() => {
    (async () => {
      const [vault, device, supported, sync] = await Promise.all([
        db.getVault(),
        db.getDevice(),
        biometricSupported(),
        db.getSyncState(),
      ]);
      setCanBiometric(supported);
      setHasBiometric(!!device);
      if (sync?.token) {
        tokenRef.current = sync.token;
        setAccount(sync.accountEmail ?? null);
      }
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
    const [sa, ss, st, sg, sm] = await Promise.all([
      db.allStoredAccounts(),
      db.allStoredSnapshots(),
      db.allStoredTransactions(),
      db.allStoredGoals(),
      db.getStoredMemory(),
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
    const txns = await Promise.all(
      st
        .filter((r) => !r.deleted)
        .map(async (r): Promise<Transaction> => {
          const c = await openJSON<TransactionContent>(key, r.content);
          return { ...c, id: r.id, at: r.at };
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
    setTransactions(txns);
    setGoals(gl);
    setMemory(sm ? await openJSON<MerchantMemory>(key, sm.content) : {});
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

  // ---- sync ---------------------------------------------------------------
  // Reconcile with the server: pull others' changes (LWW by updatedAt), then
  // push ours. Only ciphertext moves — the key never leaves this device. If the
  // pull changed anything, re-decrypt the view so the screen matches the vault.
  const runSync = useCallback(async () => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const changed = await syncNow(token);
      if (changed) {
        const { snaps } = await loadAll(key);
        void loadPrices(snaps, currency);
      }
    } catch (e) {
      // A failed sync is never fatal: the data is safe locally and dirty records
      // stay dirty, so the next attempt retries them.
      setSyncError(e instanceof Error ? e.message : "Couldn't reach sync just now.");
    } finally {
      setSyncing(false);
    }
  }, [loadAll, loadPrices, currency]);

  // Debounced sync after a write. Coalesces a burst of edits into one round-trip.
  const scheduleSync = useCallback(() => {
    if (!tokenRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSync(), 1500);
  }, [runSync]);

  // ---- setup / unlock / lock ---------------------------------------------

  const setup = useCallback(async (passphrase: string, cur: string) => {
    setBusy(true);
    setError(null);
    try {
      // Envelope model: a random DEK encrypts the data; the passphrase-derived
      // KEK only wraps it, so the passphrase can change later without
      // re-encrypting anything. The verifier validates the DEK.
      const salt = newSalt();
      const kek = await deriveKeyFromSalt(passphrase, salt, PBKDF2_ITERATIONS);
      const dek = await generateDEK();

      // Identity keypair from day one. Nothing uses it yet — see crypto.ts for
      // why it exists anyway. Wrapped by the DEK so it survives a passphrase change.
      const kp = await generateIdentityKeypair();

      await db.saveVault({
        id: "vault",
        salt,
        verifier: await makeVerifier(dek),
        wrappedDEK: await wrapVaultKey(kek, dek),
        createdAt: Date.now(),
        iterations: PBKDF2_ITERATIONS,
        currency: cur,
        identityPublic: await exportPublicKeyB64(kp.publicKey),
        identityPrivate: await wrapPrivateKey(dek, kp.privateKey),
      });

      keyRef.current = dek;
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
      // If this device is connected, sync on unlock so it opens up to date.
      if (tokenRef.current) void runSync();
    },
    [loadAll, loadPrices, runSync]
  );

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const vault = await db.getVault();
        if (!vault) return false;
        const kek = await deriveKeyFromSalt(passphrase, vault.salt, vault.iterations);

        let dek: CryptoKey;
        if (vault.wrappedDEK) {
          // Envelope vault: the KEK unwraps the DEK; a wrong passphrase fails here.
          try {
            dek = await unwrapVaultKey(kek, vault.wrappedDEK);
          } catch {
            setError("That passphrase doesn't open this vault.");
            return false;
          }
          if (!(await checkVerifier(dek, vault.verifier))) {
            setError("That passphrase doesn't open this vault.");
            return false;
          }
        } else {
          // Legacy vault: the key was derived straight from the passphrase, so it
          // IS the data key. Verify, then migrate to the envelope model in place —
          // no data is re-encrypted (the DEK stays this key).
          if (!(await checkVerifier(kek, vault.verifier))) {
            setError("That passphrase doesn't open this vault.");
            return false;
          }
          dek = kek;
          await db.saveVault({ ...vault, wrappedDEK: await wrapVaultKey(kek, dek) });
        }

        await finishUnlock(dek, vault.currency);
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
    // Drop the key and EVERYTHING derived from it. After this the process holds
    // no plaintext about the user's money. If you add a piece of decrypted state
    // above, it must be cleared here too — that is the whole contract of "lock".
    keyRef.current = null;
    setAccounts([]);
    setSnapshots([]);
    setTransactions([]);
    setGoals([]);
    setMemory({});
    setPrices({});
    clearPriceCache();
    setError(null);
    setStatus("locked");
  }, []);

  // ---- account (sync) -----------------------------------------------------

  // Connect this device's existing vault to a NEW account. The passphrase is
  // never sent — only the salt + verifier (which reveal nothing) so the same
  // vault can be re-derived on another device. The account password is a
  // separate secret that only authenticates the account (invariant #5).
  const connectCreate = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setSyncError(null);
      const em = email.trim().toLowerCase();
      const vault = await db.getVault();
      if (!vault) {
        setSyncError("Set up your vault on this device first.");
        return false;
      }
      if (!vault.identityPrivate) {
        setSyncError("This vault predates sync. Re-create it to connect an account.");
        return false;
      }
      setSyncing(true);
      try {
        const { token } = await api.register(
          em,
          password,
          { salt: vault.salt, verifier: vault.verifier, iterations: vault.iterations, currency: vault.currency, wrappedDEK: vault.wrappedDEK },
          vault.identityPublic ?? "",
          vault.identityPrivate
        );
        tokenRef.current = token;
        setAccount(em);
        const st = await db.getSyncState();
        await db.saveSyncState({ id: "state", cursor: st?.cursor ?? 0, token, accountEmail: em });
        // Nothing here has been seen by the server yet — mark it all dirty so the
        // first push uploads the whole vault.
        await db.markAllDirty();
        await runSync();
        return true;
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : "Couldn't create that account.");
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [runSync]
  );

  // Sign in to an existing account from a second device. Downloads the vault
  // metadata (salt + verifier) so the passphrase can re-derive the same key
  // here. On a fresh device this installs the vault and drops to the lock
  // screen; unlocking then pulls the ciphertext down.
  const connectSignIn = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setSyncError(null);
      const em = email.trim().toLowerCase();
      setSyncing(true);
      try {
        const { token } = await api.login(em, password);
        const dto = await api.fetchVault(token);
        tokenRef.current = token;
        setAccount(em);

        const local = await db.getVault();
        if (!local) {
          const cur = dto.currency ?? "USD";
          await db.saveVault({
            id: "vault",
            salt: dto.salt,
            verifier: dto.verifier,
            wrappedDEK: dto.wrappedDEK ?? undefined,
            createdAt: Date.now(),
            iterations: dto.iterations ?? PBKDF2_ITERATIONS,
            currency: cur,
            identityPrivate: dto.identityPrivWrapped ?? undefined,
          });
          setCurrency(cur);
          setStatus("locked");
        }
        // cursor 0 so the first sync pulls the whole history down.
        await db.saveSyncState({ id: "state", cursor: 0, token, accountEmail: em });
        if (keyRef.current) await runSync();
        return true;
      } catch (e) {
        tokenRef.current = null;
        setAccount(null);
        setSyncError(e instanceof Error ? e.message : "Couldn't sign in.");
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [runSync]
  );

  // Stop syncing from this device. Local data and the vault stay put; only the
  // token and cursor are dropped, so no more ciphertext moves either way.
  const disconnect = useCallback(async () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    tokenRef.current = null;
    setAccount(null);
    setSyncError(null);
    const st = await db.getSyncState();
    await db.saveSyncState({ id: "state", cursor: st?.cursor ?? 0 });
  }, []);

  // Permanently delete the account and every blob on the server, then disconnect.
  // Local data stays on this device — only the cloud copy is removed.
  const deleteAccount = useCallback(async (): Promise<boolean> => {
    const token = tokenRef.current;
    if (!token) return false;
    setSyncError(null);
    setSyncing(true);
    try {
      await api.deleteAccount(token);
      await disconnect();
      return true;
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Couldn't delete the account.");
      return false;
    } finally {
      setSyncing(false);
    }
  }, [disconnect]);

  // Change the passphrase (must be unlocked). Envelope encryption makes this
  // instant and re-encrypts NOTHING: it only re-wraps the DEK under a key from
  // the new passphrase. Every other device keeps reading its data with the
  // unchanged DEK, and biometric quick-unlock still works (it wraps the raw DEK).
  // Returns an error message, or null on success.
  const changePassphrase = useCallback(
    async (current: string, next: string): Promise<string | null> => {
      const dek = keyRef.current;
      if (!dek) return "Unlock the vault first.";
      if (next.length < 8) return "Use at least 8 characters for the new passphrase.";
      const vault = await db.getVault();
      if (!vault) return "No vault on this device.";

      const curKek = await deriveKeyFromSalt(current, vault.salt, vault.iterations);
      let okCurrent = false;
      try {
        if (vault.wrappedDEK) {
          const a = await exportKeyRaw(await unwrapVaultKey(curKek, vault.wrappedDEK));
          const b = await exportKeyRaw(dek);
          okCurrent = a.length === b.length && a.every((x, i) => x === b[i]);
        } else {
          okCurrent = await checkVerifier(curKek, vault.verifier);
        }
      } catch {
        okCurrent = false;
      }
      if (!okCurrent) return "That current passphrase isn't right.";

      const salt = newSalt();
      const kek = await deriveKeyFromSalt(next, salt, PBKDF2_ITERATIONS);
      const updated = {
        ...vault,
        salt,
        iterations: PBKDF2_ITERATIONS,
        verifier: await makeVerifier(dek),
        wrappedDEK: await wrapVaultKey(kek, dek),
      };
      await db.saveVault(updated);

      const token = tokenRef.current;
      if (token) {
        try {
          await api.updateVault(token, {
            salt: updated.salt,
            verifier: updated.verifier,
            iterations: updated.iterations,
            wrappedDEK: updated.wrappedDEK,
          });
        } catch (e) {
          return e instanceof Error
            ? `Changed on this device, but the server didn't update: ${e.message}`
            : "Changed on this device, but the server couldn't be reached.";
        }
      }
      return null;
    },
    []
  );

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
      scheduleSync();
    },
    [currency, loadPrices, scheduleSync]
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
        scheduleSync();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that account.");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [recordSnapshot, scheduleSync]
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
    scheduleSync();
  }, [scheduleSync]);

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

  // ---- spending -----------------------------------------------------------

  const addTransaction = useCallback(
    async (content: TransactionContent, at: number, receipt?: File) => {
      const key = keyRef.current;
      if (!key) return;
      setBusy(true);
      setError(null);
      try {
        let receiptId: string | undefined;

        // The photo. Downscaled, re-encoded, encrypted, stored. It never touches
        // the network — there is no code path from here to a server, and the CSP
        // would refuse one if there were.
        if (receipt) {
          const { bytes, type } = await compressImage(receipt);
          const sealed = await encryptBytes(key, bytes);
          receiptId = uid();
          await db.putMedia({
            id: receiptId,
            type,
            createdAt: Date.now(),
            iv: sealed.iv,
            data: sealed.data,
            deleted: false,
            dirty: true,
          });
        }

        const full: TransactionContent = { ...content, receiptId };
        const id = uid();

        setTransactions((prev) => [...prev, { ...full, id, at }]);

        await db.putStoredTransaction({
          id,
          at,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deleted: false,
          dirty: true,
          content: await sealJSON(key, full),
        });

        // Teach the categoriser. Every confirmed category is a correction, which
        // is why a hint the user accepts is promoted to something learned — and
        // why the thing gets quietly better the more you use it.
        if (content.merchant.trim()) {
          const next = remember(content.merchant, content.category, memory);
          setMemory(next);
          await db.saveStoredMemory({
            id: "memory",
            updatedAt: Date.now(),
            dirty: true,
            content: await sealJSON(key, next),
          });
        }
        scheduleSync();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save that.");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [memory, scheduleSync]
  );

  const removeTransaction = useCallback(async (id: string) => {
    const target = (await db.allStoredTransactions()).find((t) => t.id === id);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    if (!target) return;

    await db.putStoredTransaction({ ...target, deleted: true, dirty: true, updatedAt: Date.now() });

    // The receipt photo goes with it. A tombstoned expense whose picture of your
    // lunch is still sitting in the database is not a deletion.
    const key = keyRef.current;
    if (key) {
      const content = await openJSON<TransactionContent>(key, target.content);
      if (content.receiptId) await db.deleteMedia(content.receiptId);
    }
    scheduleSync();
  }, [scheduleSync]);

  const loadReceipt = useCallback(async (mediaId: string): Promise<string | null> => {
    const key = keyRef.current;
    if (!key) return null;
    const m = await db.getMedia(mediaId);
    if (!m) return null;
    try {
      const bytes = await decryptBytes(key, { iv: m.iv, data: m.data });
      return dataUrl(bytes, m.type);
    } catch {
      return null;
    }
  }, []);

  const suggest = useCallback(
    (merchant: string): Suggestion | null => suggestCategory(merchant, memory),
    [memory]
  );

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
    scheduleSync();
  }, [scheduleSync]);

  const removeGoal = useCallback(async (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    const stored = (await db.allStoredGoals()).find((g) => g.id === id);
    if (stored) {
      await db.putStoredGoal({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    }
    scheduleSync();
  }, [scheduleSync]);

  // ---- derived ------------------------------------------------------------

  const valued = valueAccounts(accounts, snapshots, prices);
  const net = currentNetWorth(valued, currency);
  const series = netWorthSeries(accounts, snapshots, prices, currency);

  const progressFor = useCallback(
    (goal: Goal): Progress =>
      goalProgress(goal, goalCurrentValue(goal, valued, transactions, currency), Date.now()),
    [valued, transactions, currency]
  );

  return {
    status,
    currency,
    error,
    busy,
    accounts,
    snapshots,
    transactions,
    goals,
    prices,
    valued,
    net,
    series,
    progressFor,
    canBiometric,
    hasBiometric,
    account,
    syncing,
    syncError,
    connectCreate,
    connectSignIn,
    disconnect,
    deleteAccount,
    changePassphrase,
    syncNow: runSync,
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
    addTransaction,
    removeTransaction,
    loadReceipt,
    suggest,
  };
}
