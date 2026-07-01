import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSession, saveSessionImage } from "./storage";
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
    expect(meta.count).toBe(2);
    expect(meta.images).toEqual([
      { file: "01.png", seed: 10 },
      { file: "02.png", seed: 11 },
    ]);
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

describe("saveSession (batch)", () => {
  it("records kind=batch and each image's prompt", async () => {
    const b64 = Buffer.from("img").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "a cat +1 more",
      model: "m",
      kind: "batch",
      images: [
        { index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1, prompt: "a cat" },
        { index: 1, dataUrl: `data:image/png;base64,${b64}`, seed: 2, prompt: "a dog" },
      ],
      rootDir: root,
    });
    expect(session.kind).toBe("batch");
    expect(session.images).toEqual([
      { file: "01.png", seed: 1, prompt: "a cat" },
      { file: "02.png", seed: 2, prompt: "a dog" },
    ]);
    const meta = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
    expect(meta.kind).toBe("batch");
    expect(meta.images[1].prompt).toBe("a dog");
  });

  it("defaults kind to variations and omits prompt when absent", async () => {
    const b64 = Buffer.from("img").toString("base64");
    const { session } = await saveSession({
      prompt: "a cat",
      model: "m",
      images: [{ index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1 }],
      rootDir: root,
    });
    expect(session.kind).toBe("variations");
    expect(session.images[0]).toEqual({ file: "01.png", seed: 1 });
  });

  it("collapses a deep requested path to just the last folder, creating it", async () => {
    const b64 = Buffer.from("img").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "a villa +1 more",
      model: "m",
      kind: "batch",
      images: [
        {
          index: 0,
          dataUrl: `data:image/png;base64,${b64}`,
          seed: 1,
          prompt: "a villa",
          path: "public/images/properties/villa/01.jpg",
        },
      ],
      rootDir: root,
    });
    expect(session.images[0].file).toBe("villa/01.png");
    const written = await fs.readFile(path.join(dir, "villa/01.png"));
    expect(written.toString()).toBe("img");
  });

  it("falls back to sequential naming for items in the batch without a path", async () => {
    const b64 = Buffer.from("img").toString("base64");
    const { session } = await saveSession({
      prompt: "a villa +1 more",
      model: "m",
      kind: "batch",
      images: [
        { index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1, prompt: "a villa", path: "villa/01.jpg" },
        { index: 1, dataUrl: `data:image/png;base64,${b64}`, seed: 2, prompt: "a cabin" },
      ],
      rootDir: root,
    });
    expect(session.images.map((i) => i.file)).toEqual(["villa/01.png", "02.png"]);
  });

  it("sanitizes a path that attempts traversal outside the session folder", async () => {
    const b64 = Buffer.from("img").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "p",
      model: "m",
      kind: "batch",
      images: [
        {
          index: 0,
          dataUrl: `data:image/png;base64,${b64}`,
          seed: 1,
          prompt: "p",
          path: "../../etc/passwd",
        },
      ],
      rootDir: root,
    });
    expect(session.images[0].file).toBe("etc/passwd.png");
    const written = await fs.readFile(path.join(dir, "etc/passwd.png"));
    expect(written.toString()).toBe("img");
  });
});

describe("saveSessionImage", () => {
  async function seedSession() {
    const b64 = Buffer.from("orig").toString("base64");
    return saveSession({
      prompt: "a villa +1 more",
      model: "m",
      kind: "batch",
      images: [
        { index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1, prompt: "a villa", path: "villa/01.jpg" },
        { index: 1, dataUrl: `data:image/png;base64,${b64}`, seed: 2, prompt: "a cabin", path: "cabin/01.jpg" },
      ],
      rootDir: root,
    });
  }

  it("writes a new image into an existing session folder and appends it to metadata", async () => {
    const { dir } = await seedSession();
    const b64 = Buffer.from("retried").toString("base64");
    await saveSessionImage({
      dir,
      file: "lodge/01.png",
      image: { index: 2, dataUrl: `data:image/png;base64,${b64}`, seed: 9, prompt: "a lodge" },
      rootDir: root,
    });

    expect((await fs.readFile(path.join(dir, "lodge/01.png"))).toString()).toBe("retried");
    const meta = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
    expect(meta.count).toBe(3);
    expect(meta.images.find((i: { file: string }) => i.file === "lodge/01.png")).toEqual({
      file: "lodge/01.png",
      seed: 9,
      prompt: "a lodge",
    });
  });

  it("replaces an existing file and its metadata entry without growing the count", async () => {
    const { dir } = await seedSession();
    const b64 = Buffer.from("rerolled").toString("base64");
    await saveSessionImage({
      dir,
      file: "villa/01.png",
      image: { index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 99, prompt: "a villa" },
      rootDir: root,
    });

    expect((await fs.readFile(path.join(dir, "villa/01.png"))).toString()).toBe("rerolled");
    const meta = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
    expect(meta.count).toBe(2);
    expect(meta.images.find((i: { file: string }) => i.file === "villa/01.png").seed).toBe(99);
  });

  it("refuses to write outside the generations root", async () => {
    await expect(
      saveSessionImage({
        dir: path.join(root, "..", "elsewhere"),
        file: "x.png",
        image: { index: 0, dataUrl: "data:image/png;base64,AAA", seed: 1 },
        rootDir: path.join(root, "generations"),
      }),
    ).rejects.toThrow(/outside the generations directory/);
  });

  it("refuses a file path that escapes the session directory", async () => {
    const { dir } = await seedSession();
    await expect(
      saveSessionImage({
        dir,
        file: "../escape.png",
        image: { index: 0, dataUrl: "data:image/png;base64,AAA", seed: 1 },
        rootDir: root,
      }),
    ).rejects.toThrow(/outside the session directory/);
  });
});
