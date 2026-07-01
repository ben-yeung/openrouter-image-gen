// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/core", () => ({
  generateVariations: vi.fn(),
  generateBatch: vi.fn(),
  generateImage: vi.fn(),
  batchLabel: (prompts: string[]) => prompts.join(" | "),
  // Identity is enough for these tests; resolveImagePaths has its own unit tests.
  resolveImagePaths: (paths: (string | undefined)[]) => paths,
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
    const freshResult = img(0, { seed: 999, dataUrl: "data:image/png;base64,NEW" });
    vi.mocked(generateImage).mockResolvedValue(freshResult);

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "k", model: "m", prompt: "p", count: 2 });
    });
    await act(async () => { await result.current.reroll(0); });

    // After reroll, the image should have the generateImage result plus the prompt from lastParams
    expect(result.current.images[0]).toEqual({ ...freshResult, prompt: "p" });
    expect(result.current.images[1]).toEqual(original[1]);
  });

  it("uses image.prompt (not lastParams.prompt) when rerolling a batch card", async () => {
    vi.mocked(generateBatch).mockResolvedValue([
      img(0, { prompt: "a cat" }),
      img(1, { prompt: "a dog" }),
    ]);
    vi.mocked(generateImage).mockResolvedValue(img(1));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({
        apiKey: "k",
        model: "m",
        items: [{ prompt: "a cat" }, { prompt: "a dog" }],
      });
    });
    await act(async () => { await result.current.reroll(1); });

    expect(vi.mocked(generateImage)).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a dog", index: 1 }),
    );
    expect(result.current.images[1].prompt).toBe("a dog");
  });

  it("attaches each item's requested path to the matching image", async () => {
    vi.mocked(generateBatch).mockResolvedValue([
      img(0, { prompt: "a villa" }),
      img(1, { prompt: "a cabin" }),
    ]);

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({
        apiKey: "k",
        model: "m",
        items: [
          { prompt: "a villa", path: "public/images/villa/01.jpg" },
          { prompt: "a cabin" },
        ],
      });
    });

    expect(result.current.images[0].path).toBe("public/images/villa/01.jpg");
    expect(result.current.images[1].path).toBeUndefined();
  });

  it("persists a rerolled image into the saved session folder via PATCH", async () => {
    vi.mocked(generateBatch).mockResolvedValue([
      img(0, { prompt: "a villa", path: "villa/01.jpg" }),
      { index: 1, dataUrl: "", error: "No image returned", prompt: "a cabin", path: "cabin/01.jpg" },
    ]);
    vi.mocked(generateImage).mockResolvedValue(img(1, { seed: 77 }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({
        apiKey: "k",
        model: "m",
        items: [
          { prompt: "a villa", path: "villa/01.jpg" },
          { prompt: "a cabin", path: "cabin/01.jpg" },
        ],
      });
    });
    mockFetch.mockClear();
    await act(async () => { await result.current.reroll(1); });

    const patch = mockFetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch).toBeTruthy();
    const body = JSON.parse(patch![1].body as string);
    expect(body.dir).toBe("/tmp");
    expect(body.file).toBe("cabin/01.jpg");
    expect(body.image.dataUrl).toBe("data:image/png;base64,AAA1");
  });

  it("creates the session on a successful reroll when the initial run saved nothing", async () => {
    // Whole batch failed on the first attempt → no session folder was created.
    vi.mocked(generateBatch).mockResolvedValue([
      { index: 0, dataUrl: "", error: "No image returned", prompt: "a villa", path: "villa/01.jpg" },
    ]);
    vi.mocked(generateImage).mockResolvedValue(img(0, { seed: 5, prompt: "a villa" }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({ apiKey: "k", model: "m", items: [{ prompt: "a villa", path: "villa/01.jpg" }] });
    });
    expect(result.current.savedDir).toBeNull();
    mockFetch.mockClear();

    await act(async () => { await result.current.reroll(0); });

    const post = mockFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post).toBeTruthy();
    const body = JSON.parse(post![1].body as string);
    expect(body.kind).toBe("batch");
    expect(body.images).toHaveLength(1);
    expect(result.current.savedDir).toBe("/tmp");
  });

  it("does not create duplicate sessions when two failed slots are retried at once", async () => {
    vi.mocked(generateBatch).mockResolvedValue([
      { index: 0, dataUrl: "", error: "fail", prompt: "a villa", path: "villa/01.jpg" },
      { index: 1, dataUrl: "", error: "fail", prompt: "a cabin", path: "cabin/01.jpg" },
    ]);
    vi.mocked(generateImage)
      .mockResolvedValueOnce(img(0, { prompt: "a villa" }))
      .mockResolvedValueOnce(img(1, { prompt: "a cabin" }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({
        apiKey: "k",
        model: "m",
        items: [{ prompt: "a villa", path: "villa/01.jpg" }, { prompt: "a cabin", path: "cabin/01.jpg" }],
      });
    });
    mockFetch.mockClear();

    await act(async () => { await Promise.all([result.current.reroll(0), result.current.reroll(1)]); });

    const posts = mockFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("does not attempt to persist a reroll that itself failed", async () => {
    vi.mocked(generateBatch).mockResolvedValue([img(0, { prompt: "a villa", path: "villa/01.jpg" })]);
    vi.mocked(generateImage).mockResolvedValue({ index: 0, dataUrl: "", error: "still failing" });

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({ apiKey: "k", model: "m", items: [{ prompt: "a villa", path: "villa/01.jpg" }] });
    });
    mockFetch.mockClear();
    await act(async () => { await result.current.reroll(0); });

    expect(mockFetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("preserves the requested path on the rerolled slot", async () => {
    vi.mocked(generateBatch).mockResolvedValue([img(0, { prompt: "a villa" })]);
    vi.mocked(generateImage).mockResolvedValue(img(0, { seed: 999 }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({
        apiKey: "k",
        model: "m",
        items: [{ prompt: "a villa", path: "public/images/villa/01.jpg" }],
      });
    });
    await act(async () => { await result.current.reroll(0); });

    expect(result.current.images[0].path).toBe("public/images/villa/01.jpg");
  });

  it("seeds pending placeholders immediately, before any image resolves", async () => {
    let resolveVariations: (imgs: ReturnType<typeof img>[]) => void = () => {};
    vi.mocked(generateVariations).mockReturnValue(
      new Promise((resolve) => {
        resolveVariations = resolve;
      }) as ReturnType<typeof generateVariations>,
    );

    const { result } = renderHook(() => useGeneration());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run({ apiKey: "k", model: "m", prompt: "p", count: 3 });
    });

    // Slots exist and are marked pending before the generation promise settles.
    expect(result.current.images).toHaveLength(3);
    expect(result.current.images.every((i) => i.pending && !i.dataUrl)).toBe(true);

    await act(async () => {
      resolveVariations([img(0), img(1), img(2)]);
      await pending;
    });
    expect(result.current.images.every((i) => !i.pending)).toBe(true);
  });

  it("reveals each variation in its slot as onResult reports it", async () => {
    vi.mocked(generateVariations).mockImplementation(
      (async (
        _params: unknown,
        count: number,
        opts?: { onResult?: (image: ReturnType<typeof img>) => void },
      ) => {
        const results = Array.from({ length: count }, (_, i) => img(i));
        // Stream the last slot first to prove placement is by index, not order.
        for (const r of [...results].reverse()) opts?.onResult?.(r);
        return results;
      }) as unknown as typeof generateVariations,
    );

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "k", model: "m", prompt: "p", count: 3 });
    });

    expect(result.current.images.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(result.current.images.map((i) => i.dataUrl)).toEqual([
      "data:image/png;base64,AAA0",
      "data:image/png;base64,AAA1",
      "data:image/png;base64,AAA2",
    ]);
  });

  it("seeds batch placeholders carrying each slot's prompt and path", async () => {
    vi.mocked(generateBatch).mockReturnValue(
      new Promise(() => {}) as ReturnType<typeof generateBatch>,
    );

    const { result } = renderHook(() => useGeneration());
    act(() => {
      result.current.runBatch({
        apiKey: "k",
        model: "m",
        items: [
          { prompt: "a villa", path: "public/images/villa/01.jpg" },
          { prompt: "a cabin" },
        ],
      });
    });

    expect(result.current.images).toHaveLength(2);
    expect(result.current.images[0]).toMatchObject({
      index: 0,
      pending: true,
      prompt: "a villa",
      path: "public/images/villa/01.jpg",
    });
    expect(result.current.images[1]).toMatchObject({ index: 1, pending: true, prompt: "a cabin" });
    expect(result.current.images[1].path).toBeUndefined();
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
