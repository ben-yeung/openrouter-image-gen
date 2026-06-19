import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSession } from "./storage";
import type { GeneratedImage } from "./types";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "imggen-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const png = (b64: string): GeneratedImage => ({ index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1 });

describe("saveSession", () => {
  it("writes images as NN.png and a metadata.json manifest", async () => {
    const aaa = Buffer.from("hello").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "a cat",
      model: "m",
      images: [{ ...png(aaa), index: 0, seed: 10 }, { ...png(aaa), index: 1, seed: 11 }],
      rootDir: root,
      now: new Date(2026, 5, 19, 14, 30, 0),
    });

    const files = (await fs.readdir(dir)).sort();
    expect(files).toEqual(["01.png", "02.png", "metadata.json"]);
    expect(session.count).toBe(2);
    expect(session.images).toEqual([
      { file: "01.png", seed: 10 },
      { file: "02.png", seed: 11 },
    ]);

    const written = await fs.readFile(path.join(dir, "01.png"));
    expect(written.toString()).toBe("hello");

    const meta = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
    expect(meta.prompt).toBe("a cat");
    expect(meta.model).toBe("m");
  });

  it("skips failed variations", async () => {
    const aaa = Buffer.from("x").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "p",
      model: "m",
      images: [
        { index: 0, dataUrl: `data:image/png;base64,${aaa}`, seed: 1 },
        { index: 1, dataUrl: "", error: "boom", seed: 2 },
      ],
      rootDir: root,
    });
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".png"));
    expect(files).toEqual(["01.png"]);
    expect(session.count).toBe(1);
  });
});
