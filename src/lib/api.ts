// api.ts
// Thin client for the Ballast sync server. It only ever sends/receives opaque
// ciphertext + non-secret metadata — never the passphrase or the key. The auth
// token is separate from the encryption passphrase (invariant #5).

import type { CipherBlob, WrappedKey } from "./crypto";

const API_BASE = "https://ballast-server.jdd994.workers.dev";

export type VaultMetaDTO = {
  salt: number[];
  verifier: CipherBlob;
  iterations?: number;
  identityPrivWrapped?: WrappedKey | null;
  // Base display currency — plaintext, non-secret. Travels with the vault so a
  // new device labels money in the right units before there's anything to sync.
  currency?: string | null;
};

// A record on the wire: opaque content + optional non-secret `meta` (a snapshot's
// accountId + at, a transaction's at) the server passes through unread.
export type SyncRecord = {
  kind: "account" | "snapshot" | "transaction" | "goal";
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  content: CipherBlob;
  meta?: Record<string, unknown>;
};

async function req(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<any> {
  const res = await fetch(API_BASE + path, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
  return data;
}

export function register(
  email: string,
  password: string,
  vault: VaultMetaDTO,
  identityPublicKey: string,
  identityPrivWrapped: WrappedKey
): Promise<{ token: string; userId: string }> {
  return req("/auth/register", {
    method: "POST",
    body: { email, password, vault, identityPublicKey, identityPrivWrapped },
  });
}

export function login(email: string, password: string): Promise<{ token: string; userId: string }> {
  return req("/auth/login", { method: "POST", body: { email, password } });
}

export function fetchVault(token: string): Promise<VaultMetaDTO> {
  return req("/vault", { token });
}

export function pushChanges(token: string, changes: SyncRecord[]): Promise<{ applied: number; cursor: number }> {
  return req("/sync/push", { method: "POST", token, body: { changes } });
}

export function pullChanges(
  token: string,
  since: number
): Promise<{ changes: SyncRecord[]; cursor: number; more: boolean }> {
  return req(`/sync/pull?since=${since}`, { token });
}
