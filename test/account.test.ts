import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { describe, expect, it } from "vitest";
import { CcnodesAccount, KeyLimitError, ensureApiKey, memoryCredentialStore } from "../src/account.js";
import { CcnodesClient } from "../src/index.js";
import { privateKeySigner } from "../src/node.js";
import { mockFetch } from "./helpers.js";

const base = "https://example.test/v1";
const PK = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
const ADDR = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23";

/** Recover the signer the way the server does (EIP-191 personal_sign). */
function recover(message: string, sigHex: string): string {
  const sig = Uint8Array.from(Buffer.from(sigHex.replace(/^0x/, ""), "hex"));
  const msg = new TextEncoder().encode(message);
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), Buffer.from(msg)]));
  const s = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(sig[64]! - 27);
  const pub = s.recoverPublicKey(digest).toRawBytes(false).slice(1);
  return "0x" + Buffer.from(keccak_256(pub).slice(-20)).toString("hex");
}

/** A fake API with the same rules as mgmt.rs: one-time nonces, real signature check, key cap. */
function fakeServer(opts: { maxKeys?: number; existingKeys?: number } = {}) {
  const nonces = new Map<string, { address: string; message: string }>();
  const keys: Array<{ id: number; label: string | null; tier: string; active: boolean; created_at: string }> = [];
  for (let i = 0; i < (opts.existingKeys ?? 0); i++) keys.push({ id: 100 + i, label: "old", tier: "free", active: true, created_at: "t" });
  let nextId = 1;
  const m = mockFetch(({ url, method, headers, body }) => {
    const path = url.replace(base, "");
    const b = body ? JSON.parse(body) : {};
    if (path === "/auth/siwe/nonce") {
      const nonce = "a".repeat(31) + String(nonces.size);
      const message = `example.test wants you to sign in with your Ethereum account:\n${b.address}\n\nNonce: ${nonce}`;
      nonces.set(nonce, { address: b.address, message });
      return { body: { nonce, message } };
    }
    if (path === "/auth/siwe/verify") {
      const n = nonces.get(b.nonce);
      nonces.delete(b.nonce);
      if (!n) return { status: 400, body: { error: "nonce expired or already used" } };
      if (recover(n.message, b.signature) !== n.address) return { status: 401, body: { error: "signature does not match address" } };
      return { body: { token: "ccxs_sess", account_id: 7, address: n.address, expires_in: 604800 } };
    }
    if (headers.authorization !== "Bearer ccxs_sess") return { status: 401, body: { error: "no session" } };
    if (path === "/me") return { body: { account_id: 7, max_keys: opts.maxKeys ?? 2, plan: "free", rate_per_sec: 8 } };
    if (path === "/me/keys" && method === "GET") return { body: { keys } };
    if (path === "/me/keys" && method === "POST") {
      if (keys.length >= (opts.maxKeys ?? 2)) return { status: 400, body: { error: "key limit reached (2) — upgrade your plan for more" } };
      const id = nextId++;
      keys.push({ id, label: b.label ?? null, tier: "free", active: true, created_at: "t" });
      return { body: { id, key: `ccx_new${id}` } };
    }
    const rot = path.match(/^\/me\/keys\/(\d+)\/rotate$/);
    if (rot) return { body: { id: Number(rot[1]), key: `ccx_rotated${rot[1]}` } };
    return { status: 404, body: { error: "not found" } };
  });
  return { ...m, keys };
}

describe("sign-in", () => {
  it("signs the server's message and gets a session", async () => {
    const srv = fakeServer();
    const client = new CcnodesClient({ baseUrl: base, fetch: srv.fn });
    const signer = await privateKeySigner(PK);
    const acct = await CcnodesAccount.signIn(client, signer);
    expect(acct.session.token).toBe("ccxs_sess");
    expect(acct.session.address).toBe(ADDR);
  });
});

describe("ensureApiKey", () => {
  it("creates a key once, then reuses it with NO network call", async () => {
    const srv = fakeServer();
    const client = new CcnodesClient({ baseUrl: base, fetch: srv.fn });
    const store = memoryCredentialStore();
    const signer = await privateKeySigner(PK);

    const first = await ensureApiKey({ client, ...signer, store });
    expect(first.source).toBe("created");
    expect(srv.keys[0]!.label).toBe("ccnodes-sdk");

    const before = srv.calls.length;
    const second = await ensureApiKey({ client, ...signer, store });
    expect(second).toEqual({ apiKey: first.apiKey, keyId: first.keyId, source: "stored" });
    expect(srv.calls.length).toBe(before);
    expect(srv.keys).toHaveLength(1);
  });

  it("refuses rather than rotating a key it did not create when the plan is full", async () => {
    const srv = fakeServer({ maxKeys: 2, existingKeys: 2 });
    const client = new CcnodesClient({ baseUrl: base, fetch: srv.fn });
    const err = await ensureApiKey({ client, ...(await privateKeySigner(PK)) }).catch((e) => e);
    expect(err).toBeInstanceOf(KeyLimitError);
    expect(err.maxKeys).toBe(2);
    expect(srv.calls.some((c) => /rotate/.test(c.url))).toBe(false);
  });

  it("rotates only when asked, and stores the new secret", async () => {
    const srv = fakeServer();
    const client = new CcnodesClient({ baseUrl: base, fetch: srv.fn });
    const store = memoryCredentialStore();
    const signer = await privateKeySigner(PK);
    const first = await ensureApiKey({ client, ...signer, store });
    const rotated = await ensureApiKey({ client, ...signer, store, rotate: true });
    expect(rotated.source).toBe("rotated");
    expect(rotated.keyId).toBe(first.keyId);
    expect(rotated.apiKey).not.toBe(first.apiKey);
    expect((await ensureApiKey({ client, ...signer, store })).apiKey).toBe(rotated.apiKey);
  });

  it("rejects a signer that returns garbage before calling verify", async () => {
    const srv = fakeServer();
    const client = new CcnodesClient({ baseUrl: base, fetch: srv.fn });
    const err = await ensureApiKey({ client, address: ADDR, signMessage: async () => "nope" }).catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(srv.calls.some((c) => c.url.endsWith("/auth/siwe/verify"))).toBe(false);
  });
});
