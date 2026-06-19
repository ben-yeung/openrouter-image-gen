// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/core", () => ({
  generateVariations: vi.fn(),
  generateBatch: vi.fn(),
  generateImage: vi.fn(),
  batchLabel: (prompts: string[]) => prompts.join(" | "),
}));

import { generateVariations, generateBatch, generateImage } from "@/core";
import { useGeneration } from "./useGeneration";

const img = (i: number, extra: Record<string, unknown> = {}) => ({
  index: i,
  dataUrl: `data:image/png;base64,AAA${i}`,
  seed: 100 + i,
  ...extra,
});

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ dir: "/tmp" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("useGeneration reroll", () => {
  it("exposes rerolling as an empty Set and reroll as a function", () => {
    const { result } = renderHook(() => useGeneration());
    expect(result.current.rerolling).toBeInstanceOf(Set);
    expect(result.current.rerolling.size).toBe(0);
    expect(typeof result.current.reroll).toBe("function");
  });

  it("no-ops when called before any generation has run", async () => {
    const { result } = renderHook(() => useGeneration());
    await act(async () => { await result.current.reroll(0); });
    expect(vi.mocked(generateImage)).not.toHaveBeenCalled();
  });

  it("calls generateImage with the stored apiKey, model, prompt, and the slot index", async () => {
    vi.mocked(generateVariations).mockResolvedValue([img(0), img(1)]);
    vi.mocked(generateImage).mockResolvedValue(img(0, { seed: 999 }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "sk-test", model: "flux/dev", prompt: "a fox", count: 2 });
    });
    await act(async () => { await result.current.reroll(0); });

    expect(vi.mocked(generateImage)).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test", model: "flux/dev", prompt: "a fox", index: 0 }),
    );
  });

  it("replaces only the rerolled slot; other slots are unchanged", async () => {
    const original = [img(0), img(1)];
    vi.mocked(generateVariations).mockResolvedValue(original);
    const fresh = img(0, { seed: 999, dataUrl: "data:image/png;base64,NEW" });
    vi.mocked(generateImage).mockResolvedValue(fresh);

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "k", model: "m", prompt: "p", count: 2 });
    });
    await act(async () => { await result.current.reroll(0); });

    expect(result.current.images[0]).toEqual(fresh);
    expect(result.current.images[1]).toEqual(original[1]);
  });

  it("uses image.prompt (not lastParams.prompt) when rerolling a batch card", async () => {
    vi.mocked(generateBatch).mockResolvedValue([
      img(0, { prompt: "a cat" }),
      img(1, { prompt: "a dog" }),
    ]);
    vi.mocked(generateImage).mockResolvedValue(img(1, { prompt: "a dog" }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({ apiKey: "k", model: "m", prompts: ["a cat", "a dog"] });
    });
    await act(async () => { await result.current.reroll(1); });

    expect(vi.mocked(generateImage)).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a dog", index: 1 }),
    );
  });

  it("clears the index from rerolling after the call resolves", async () => {
    vi.mocked(generateVariations).mockResolvedValue([img(0)]);
    vi.mocked(generateImage).mockResolvedValue(img(0, { seed: 42 }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "k", model: "m", prompt: "p", count: 1 });
    });
    await act(async () => { await result.current.reroll(0); });

    expect(result.current.rerolling.has(0)).toBe(false);
    expect(result.current.rerolling.size).toBe(0);
  });
});
