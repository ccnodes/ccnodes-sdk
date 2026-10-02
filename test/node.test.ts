import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileCredentialStore, privateKeySigner } from "../src/node.js";

describe("privateKeySigner", () => {
  // web3.js documented vector (web3.eth.accounts.sign, "Some data").
  const PK = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";

  it("derives the documented address", async () => {
    const s = await privateKeySigner(PK);
    expect(s.address).toBe("0x2c7536e3605d9c16a7a3d7b1898e529396a65c23");
  });

  it("produces the documented personal_sign signature", async () => {
    const s = await privateKeySigner(PK);
    expect(await s.signMessage("Some data")).toBe(
      "0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c",
    );
  });

  it("rejects a malformed key", async () => {
    await expect(privateKeySigner("0x1234")).rejects.toThrow(TypeError);
  });
});

describe("fileCredentialStore", () => {
  it("writes the key file 0600 and reads it back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ccnodes-"));
    const path = join(dir, "sub", "credentials.json");
    const store = fileCredentialStore(path);
    expect(await store.get("x")).toBeNull();
    const v = { address: "0xab", baseUrl: "b", apiKey: "ccx_1", keyId: 1, label: "l", createdAt: "t" };
    await store.set("x", v);
    expect(await store.get("x")).toEqual(v);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
  });
});
