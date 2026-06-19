import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "imggen-cfg-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

describe("cli config", () => {
  it("prefers the env var", async () => {
    process.env.OPENROUTER_API_KEY = "env-key";
    const { loadKey } = await import("./config");
    expect(loadKey()).toBe("env-key");
  });

  it("round-trips a saved key via the config file", async () => {
    const { saveKey, loadKey } = await import("./config");
    saveKey("file-key");
    expect(loadKey()).toBe("file-key");
  });

  it("returns null when nothing is set", async () => {
    const { loadKey } = await import("./config");
    expect(loadKey()).toBeNull();
  });
});
