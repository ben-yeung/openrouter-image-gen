import { describe, it, expect, vi } from "vitest";
import { generateImage, generateVariations } from "./generate";

const imageResponse = (url: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: "ok", images: [{ image_url: { url } }] } }] }),
});

describe("generateImage", () => {
  it("returns the data URL from message.images", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const img = await generateImage(
      { apiKey: "k", model: "m", prompt: "p", index: 0, seed: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(img.dataUrl).toBe("data:image/png;base64,AAA");
    expect(img.seed).toBe(5);
    expect(img.error).toBeUndefined();
  });

  it("sends seed and bearer auth in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    await generateImage(
      { apiKey: "secret", model: "m", prompt: "p", seed: 9 },
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const body = JSON.parse(init.body as string);
    expect(body.seed).toBe(9);
    expect(body.modalities).toEqual(["image", "text"]);
  });

  it("returns an error for 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const img = await generateImage(
      { apiKey: "k", model: "m", prompt: "p" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(img.error).toMatch(/401/);
    expect(img.dataUrl).toBe("");
  });

  it("returns an error when no image is present (text-only)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "I can't do that" } }] }),
    });
    const img = await generateImage(
      { apiKey: "k", model: "m", prompt: "p" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(img.error).toMatch(/can't do that/);
  });

  it("omits seed from the body when not provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    await generateImage(
      { apiKey: "k", model: "m", prompt: "p" },
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect("seed" in body).toBe(false);
  });
});

describe("generateVariations", () => {
  it("fires N requests with distinct sequential seeds and indexes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const imgs = await generateVariations(
      { apiKey: "k", model: "m", prompt: "p" },
      3,
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 100 },
    );
    expect(imgs).toHaveLength(3);
    expect(imgs.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(imgs.map((i) => i.seed)).toEqual([100, 101, 102]);
  });

  it("allows partial success (one failure does not abort the batch)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse("data:image/png;base64,AAA"))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const imgs = await generateVariations(
      { apiKey: "k", model: "m", prompt: "p" },
      2,
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 0 },
    );
    expect(imgs.filter((i) => i.dataUrl !== "")).toHaveLength(1);
    expect(imgs.filter((i) => i.error !== undefined)).toHaveLength(1);
  });

  it("reports each image via onResult as it settles", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const seen: number[] = [];
    await generateVariations(
      { apiKey: "k", model: "m", prompt: "p" },
      3,
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 0, onResult: (img) => seen.push(img.index) },
    );
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

import { generateBatch } from "./generate";

describe("generateBatch", () => {
  const imageResponse = (url: string) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "ok", images: [{ image_url: { url } }] } }],
    }),
  });

  it("fires one request per prompt with distinct seeds and attaches each prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const imgs = await generateBatch(
      ["a cat", "a dog", "a bird"],
      { apiKey: "k", model: "m" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 100 },
    );
    expect(imgs).toHaveLength(3);
    expect(imgs.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(imgs.map((i) => i.seed)).toEqual([100, 101, 102]);
    expect(imgs.map((i) => i.prompt)).toEqual(["a cat", "a dog", "a bird"]);
  });

  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return imageResponse("data:image/png;base64,AAA");
    });
    await generateBatch(
      Array.from({ length: 12 }, (_, i) => `p${i}`),
      { apiKey: "k", model: "m" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 0, concurrency: 5 },
    );
    expect(peak).toBeLessThanOrEqual(5);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });

  it("allows partial success and tags the failed prompt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse("data:image/png;base64,AAA"))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const imgs = await generateBatch(
      ["good prompt", "bad prompt"],
      { apiKey: "k", model: "m" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 0, concurrency: 5 },
    );
    expect(imgs.filter((i) => i.dataUrl)).toHaveLength(1);
    const failed = imgs.find((i) => i.error);
    expect(failed?.prompt).toBe("bad prompt");
  });

  it("reports each image (with its prompt) via onResult as it settles", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const seen: { index: number; prompt?: string }[] = [];
    await generateBatch(
      ["a cat", "a dog"],
      { apiKey: "k", model: "m" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        baseSeed: 0,
        concurrency: 5,
        onResult: (img) => seen.push({ index: img.index, prompt: img.prompt }),
      },
    );
    expect(seen.sort((a, b) => a.index - b.index)).toEqual([
      { index: 0, prompt: "a cat" },
      { index: 1, prompt: "a dog" },
    ]);
  });
});
