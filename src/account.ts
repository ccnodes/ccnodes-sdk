/**
 * `ccnodes/account` — sign in with an Ethereum wallet and manage API keys.
 *
 * Nothing here touches a private key. You pass a `signMessage` function, which
 * is whatever your environment already signs with:
 *
 * ```ts
 * // browser wallet
 * const signMessage = (msg: string) =>
 *   window.ethereum.request({ method: "personal_sign", params: [msg, address] });
 * // viem
 * const signMessage = (msg: string) => walletClient.signMessage({ account, message: msg });
 * ```
 *
 * Signing in with an address the API has never seen creates its account. That
 * is the whole registration: no email, no form.
 */

import type { CcnodesClient } from "./client.js";
import { CcnodesApiError } from "./errors.js";

/** Signs `message` with EIP-191 `personal_sign`; resolves to a 0x-prefixed 65-byte hex signature. */
export type SignMessage = (message: string) => Promise<string>;

export interface Session {
  token: string;
  accountId: number;
  address: string;
  /** Unix ms. Sessions last seven days. */
  expiresAt: number;
}

export interface AccountInfo {
  account_id: number;
  address: string | null;
  email: string | null;
  plan: string;
  plan_status: string | null;
  monthly_cu: number | null;
  rate_per_sec: number;
  /** How many keys this account may hold. Revoked keys still count against it. */
  max_keys: number;
  created_at: string;
  [k: string]: unknown;
}

export interface ApiKeyInfo {
  id: number;
  label: string | null;
  tier: string;
  active: boolean;
  created_at: string;
}

export interface NewApiKey {
  id: number;
  /** The raw key. Returned exactly once: the server stores only its hash. */
  key: string;
}

export class CcnodesAccount {
  private constructor(
    private readonly client: CcnodesClient,
    readonly session: Session,
  ) {}

  /**
   * Sign in (and register, if this address is new) by signing the server's
   * one-time message. One `signMessage` call.
   */
  static async signIn(
    client: CcnodesClient,
    { address, signMessage }: { address: string; signMessage: SignMessage },
  ): Promise<CcnodesAccount> {
    const addr = normalizeAddress(address);
    const { nonce, message } = (await client._request("POST", "/auth/siwe/nonce", {
      body: { address: addr },
    })) as { nonce: string; message: string };
    const signature = await signMessage(message);
    if (typeof signature !== "string" || !/^(0x)?[0-9a-fA-F]{130}$/.test(signature)) {
      throw new TypeError("signMessage must resolve to a 65-byte hex signature");
    }
    const v = (await client._request("POST", "/auth/siwe/verify", {
      body: { nonce, signature },
    })) as { token: string; account_id: number; address: string; expires_in: number };
    return new CcnodesAccount(client, {
      token: v.token,
      accountId: v.account_id,
      address: v.address,
      expiresAt: Date.now() + v.expires_in * 1000,
    });
  }

  /** Resume a session you persisted yourself. */
  static fromSession(client: CcnodesClient, session: Session): CcnodesAccount {
    return new CcnodesAccount(client, session);
  }

  me(): Promise<AccountInfo> {
    return this.call("GET", "/me") as Promise<AccountInfo>;
  }
  async listKeys(): Promise<ApiKeyInfo[]> {
    return ((await this.call("GET", "/me/keys")) as { keys: ApiKeyInfo[] }).keys;
  }
  /** Create a key. Fails with `key limit reached` once the plan's cap is used. */
  createKey(label?: string): Promise<NewApiKey> {
    return this.call("POST", "/me/keys", label ? { label } : {}) as Promise<NewApiKey>;
  }
  /** Replace a key's secret. The old secret stops working immediately. */
  rotateKey(id: number): Promise<NewApiKey> {
    return this.call("POST", `/me/keys/${id}/rotate`) as Promise<NewApiKey>;
  }
  updateKey(id: number, patch: { active?: boolean; label?: string }): Promise<unknown> {
    return this.call("PATCH", `/me/keys/${id}`, patch);
  }
  async logout(): Promise<void> {
    await this.call("POST", "/auth/logout");
  }

  private call(method: string, path: string, body?: unknown): Promise<unknown> {
    return this.client._request(method, path, { body, bearer: this.session.token });
  }
}

// ---- auto-registration -------------------------------------------------------------

export interface StoredCredentials {
  address: string;
  baseUrl: string;
  apiKey: string;
  keyId: number;
  label: string | null;
  createdAt: string;
}

/** Where `ensureApiKey` keeps the key it created. `ccnodes/node` ships a file-backed one. */
export interface CredentialStore {
  get(id: string): Promise<StoredCredentials | null>;
  set(id: string, value: StoredCredentials): Promise<void>;
}

/** Keeps credentials for the life of the process only. */
export function memoryCredentialStore(): CredentialStore {
  const m = new Map<string, StoredCredentials>();
  return {
    async get(id) {
      return m.get(id) ?? null;
    },
    async set(id, v) {
      m.set(id, v);
    },
  };
}

export class KeyLimitError extends Error {
  readonly name = "KeyLimitError";
  constructor(
    readonly keys: ApiKeyInfo[],
    readonly maxKeys: number,
  ) {
    super(
      `this account already holds ${keys.length} API key(s) and its plan allows ${maxKeys} ` +
        `(revoked keys count). ensureApiKey will not rotate a key it did not create, because ` +
        `that would break whatever is using it. Pass { rotateKeyId: <id> } to replace one ` +
        `deliberately, or use an existing key directly. Keys: ` +
        keys.map((k) => `#${k.id} ${k.label ?? "(no label)"}${k.active ? "" : " [revoked]"}`).join(", "),
    );
  }
}

export interface EnsureApiKeyOptions {
  client: CcnodesClient;
  address: string;
  signMessage: SignMessage;
  /** Default: memory only. Use `fileCredentialStore()` from `ccnodes/node` to keep it. */
  store?: CredentialStore;
  /** Label for a key created here. Default `"ccnodes-sdk"`. */
  label?: string;
  /**
   * Replace the stored key's secret (or the key with this id) instead of
   * reusing it. The old secret stops working at once — rotate deliberately.
   */
  rotate?: boolean;
  rotateKeyId?: number;
}

export interface EnsuredKey {
  apiKey: string;
  keyId: number;
  /** "stored": reused, no network call. "created" / "rotated": a request was made. */
  source: "stored" | "created" | "rotated";
}

/**
 * Get an API key for a wallet, creating one at most ONCE.
 *
 * Free plans hold two keys for life (revoked keys count), and the server
 * returns a raw key exactly once. So this reuses a stored key whenever there
 * is one, creates a key only when the plan has room, and never rotates unless
 * asked — a library that minted a key per run would brick the account on its
 * third run.
 */
export async function ensureApiKey(opts: EnsureApiKeyOptions): Promise<EnsuredKey> {
  const store = opts.store ?? memoryCredentialStore();
  const address = normalizeAddress(opts.address);
  const id = credentialId(opts.client.baseUrl, address);
  const stored = await store.get(id);
  const wantRotate = Boolean(opts.rotate) || opts.rotateKeyId !== undefined;

  if (stored && !wantRotate) {
    return { apiKey: stored.apiKey, keyId: stored.keyId, source: "stored" };
  }

  const account = await CcnodesAccount.signIn(opts.client, { address, signMessage: opts.signMessage });
  const label = opts.label ?? "ccnodes-sdk";
  let fresh: NewApiKey;
  let source: EnsuredKey["source"];

  const rotateId = opts.rotateKeyId ?? (opts.rotate ? stored?.keyId : undefined);
  if (rotateId !== undefined) {
    fresh = await account.rotateKey(rotateId);
    source = "rotated";
  } else {
    const [me, keys] = await Promise.all([account.me(), account.listKeys()]);
    if (keys.length >= me.max_keys) throw new KeyLimitError(keys, me.max_keys);
    try {
      fresh = await account.createKey(label);
    } catch (e) {
      if (e instanceof CcnodesApiError && /key limit/i.test(e.message)) {
        throw new KeyLimitError(await account.listKeys(), me.max_keys);
      }
      throw e;
    }
    source = "created";
  }

  // Persist BEFORE returning: the raw key cannot be fetched again.
  await store.set(id, {
    address,
    baseUrl: opts.client.baseUrl,
    apiKey: fresh.key,
    keyId: fresh.id,
    label: source === "created" ? label : stored?.label ?? null,
    createdAt: new Date().toISOString(),
  });
  return { apiKey: fresh.key, keyId: fresh.id, source };
}

export function credentialId(baseUrl: string, address: string): string {
  return `${baseUrl.replace(/\/+$/, "")}|${address.toLowerCase()}`;
}

function normalizeAddress(a: string): string {
  const s = a.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) throw new TypeError(`not an Ethereum address: ${a}`);
  return s;
}
