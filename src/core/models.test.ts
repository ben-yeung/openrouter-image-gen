import { describe, it, expect, vi } from "vitest";
import { fetchImageModels, isValidSlugFormat, mergeModels, TOP_MODELS } from "./models";

describe("mergeModels", () => {
  it("puts curated first, then non-curated live models, deduped by id", () => {
    const curated = [{ id: "a/b", name: "Curated B", curated: true }];
    const live = [
      { id: "a/b", name: "Live B", curated: false },
      { id: "c/d", name: "Live D", curated: false },
    ];
    const merged = mergeModels(curated, live);
    expect(merged.map((m) => m.id)).toEqual(["a/b", "c/d"]);
    expect(merged[0].curated).toBe(true);
    expect(merged[0].name).toBe("Live B"); // prefers live name
  });
});

describe("fetchImageModels", () => {
  it("filters to models with image output and merges with curated", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "x/text-only", name: "T", architecture: { output_modalities: ["text"] } },
          { id: "x/img", name: "Img", architecture: { output_modalities: ["image", "text"] } },
        ],
      }),
    });
    const models = await fetchImageModels(fakeFetch as unknown as typeof fetch);
    expect(models.some((m) => m.id === "x/img")).toBe(true);
    expect(models.some((m) => m.id === "x/text-only")).toBe(false);
    expect(models.some((m) => m.id === TOP_MODELS[0].id)).toBe(true);
  });

  it("falls back to TOP_MODELS on fetch failure", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("network"));
    const models = await fetchImageModels(fakeFetch as unknown as typeof fetch);
    expect(models).toEqual(TOP_MODELS);
  });

  it("falls back to TOP_MODELS on non-ok response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const models = await fetchImageModels(fakeFetch as unknown as typeof fetch);
    expect(models).toEqual(TOP_MODELS);
  });
});

describe("isValidSlugFormat", () => {
  it("accepts well-formed slugs", () => {
    for (const s of [
      "a/b",
      "google/gemini-3.1-flash-image-preview",
      "black-forest-labs/flux-1.1-pro",
      "author/model.name",
      "a/b:free",
    ]) {
      expect(isValidSlugFormat(s)).toBe(true);
    }
  });

  it("rejects malformed slugs", () => {
    for (const s of [
      "",
      "noslash",
      "a/b/c",
      "/b",
      "a/",
      "a b/c",
      "a/b:",
      "a/b:c:d",
    ]) {
      expect(isValidSlugFormat(s)).toBe(false);
    }
  });
});
