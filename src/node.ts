/**
 * `ccnodes/node` — conveniences that only make sense in Node: files on disk,
 * environment variables, and an opt-in private-key signer.
 *
 * Kept out of the core so a browser bundle never pulls in `node:fs`, and so
 * nobody reading public blocks pulls in a secp256k1 implementation.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { CredentialStore, SignMessage, StoredCredentials } from "./account.js";
import { CcnodesClient, type CcnodesClientOptions } from "./client.js";
import type { ManifestCache } from "./manifest.js";
import type { Chain } from "./types.js";

/** `~/.ccnodes` unless `CCNODES_HOME` is set. */
export function ccnodesHome(): string {
  return process.env.CCNODES_HOME || join(homedir(), ".ccnodes");
}

/**
 * Credentials in a JSON file, mode 0600 in a 0700 directory, written
 * atomically. Default `~/.ccnodes/credentials.json`.
 *
 * This file holds a live API key. Do not commit it; in CI, prefer passing the
 * key as `CCNODES_API_KEY` from your secret store.
 */
export function fileCredentialStore(path = join(ccnodesHome(), "credentials.json")): CredentialStore {
  type File = { version: 1; entries: Record<string, StoredCredentials> };
  const read = async (): Promise<File> => {
    try {
      const f = JSON.parse(await readFile(path, "utf8")) as File;
      return f && f.entries ? f : { version: 1, entries: {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} };
      throw e; // a corrupt credentials file must not be silently overwritten
    }
  };
  return {
    async get(id) {
      return (await read()).entries[id] ?? null;
    },
    async set(id, value) {
      const f = await read();
      f.entries[id] = value;
      await writeAtomic(path, JSON.stringify(f, null, 2) + "\n", 0o600);
    },
  };
}

/** Persists chain-list refreshes. Default `~/.ccnodes/chains.json`. */
export function fileManifestCache(path = join(ccnodesHome(), "chains.json")): ManifestCache {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as { fetchedAt: number; chains: Chain[] };
      } catch {
        return null;
      }
    },
    async save(entry) {
      await writeAtomic(path, JSON.stringify(entry) + "\n", 0o644);
    },
  };
}

/**
 * A client configured from the environment: `CCNODES_API_KEY`, and
 * `CCNODES_BASE_URL` if set. Chain-list refreshes are cached on disk.
 */
export function clientFromEnv(opts: CcnodesClientOptions = {}): CcnodesClient {
  return new CcnodesClient({
    apiKey: process.env.CCNODES_API_KEY,
    baseUrl: process.env.CCNODES_BASE_URL || undefined,
    manifestCache: fileManifestCache(),
    ...opts,
  });
}

/**
 * Sign with a raw private key. Opt-in, for servers and agents that hold one
 * anyway; a browser should use the wallet's own `personal_sign` instead.
 *
 * Needs the optional peer dependencies:
 *   npm install @noble/curves @noble/hashes
 */
export async function privateKeySigner(privateKeyHex: string): Promise<{ address: string; signMessage: SignMessage }> {
  const hex = privateKeyHex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new TypeError("private key must be 32 bytes of hex");
  let secp256k1: typeof import("@noble/curves/secp256k1").secp256k1;
  let keccak_256: typeof import("@noble/hashes/sha3").keccak_256;
  try {
    ({ secp256k1 } = await import("@noble/curves/secp256k1"));
    ({ keccak_256 } = await import("@noble/hashes/sha3"));
  } catch {
    throw new Error("privateKeySigner needs the optional peer dependencies: npm install @noble/curves @noble/hashes");
  }
  const priv = hexToBytes(hex);
  const pub = secp256k1.getPublicKey(priv, false).slice(1); // drop the 0x04 prefix
  const address = "0x" + bytesToHex(keccak_256(pub).slice(-20));

  const signMessage: SignMessage = async (message) => {
    const msg = new TextEncoder().encode(message);
    const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
    const digest = keccak_256(concat(prefix, msg));
    const sig = secp256k1.sign(digest, priv);
    return "0x" + bytesToHex(sig.toCompactRawBytes()) + (27 + sig.recovery).toString(16).padStart(2, "0");
  };
  return { address, signMessage };
}

// ---- helpers ------------------------------------------------------------------------

async function writeAtomic(path: string, data: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export { CcnodesClient };
