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
});
