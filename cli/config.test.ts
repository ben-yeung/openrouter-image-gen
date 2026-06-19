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

describe("cli split model config", () => {
  it("defaults to DEFAULT_SPLIT_MODEL when unset", async () => {
    const { loadSplitModel } = await import("./config");
    const { DEFAULT_SPLIT_MODEL } = await import("../src/core/types");
    expect(loadSplitModel()).toBe(DEFAULT_SPLIT_MODEL);
  });

  it("round-trips a saved split model alongside the key", async () => {
    const { saveKey, saveSplitModel, loadSplitModel, loadKey } = await import("./config");
    saveKey("file-key");
    saveSplitModel("openai/gpt-5-mini");
    expect(loadSplitModel()).toBe("openai/gpt-5-mini");
    expect(loadKey()).toBe("file-key"); // saving the model must not clobber the key

    // Reverse direction: saving the key after the model must not clobber the model
    saveKey("file-key-updated");
    expect(loadSplitModel()).toBe("openai/gpt-5-mini");
    expect(loadKey()).toBe("file-key-updated");
  });
});
