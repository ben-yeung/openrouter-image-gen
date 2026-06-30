import { describe, it, expect, vi } from "vitest";
import { splitPrompts, combinePrompt, batchLabel, SplitError } from "./split";

describe("batchLabel", () => {
  it("labels a multi-prompt batch with '+N more'", () => {
    expect(batchLabel(["a cat in space", "a dog", "a bird"])).toBe("a cat in space +2 more");
  });
  it("returns the single prompt unchanged when there is one", () => {
    expect(batchLabel(["a cat"])).toBe("a cat");
  });
});

describe("combinePrompt", () => {
  it("appends the suffix with just a space when the prompt already ends with punctuation", () => {
    expect(combinePrompt("A villa at sunset.", "Photorealistic, 8k")).toBe(
      "A villa at sunset. Photorealistic, 8k",
    );
  });

  it("inserts '. ' between prompt and suffix when the prompt has no trailing punctuation", () => {
    expect(combinePrompt("A villa at sunset", "Photorealistic, 8k")).toBe(
      "A villa at sunset. Photorealistic, 8k",
    );
  });

  it("returns the prompt unchanged when there is no suffix", () => {
    expect(combinePrompt("A villa at sunset.")).toBe("A villa at sunset.");
  });

  it("returns the prompt unchanged when the suffix is blank", () => {
    expect(combinePrompt("A villa at sunset.", "   ")).toBe("A villa at sunset.");
  });

  it("trims both the prompt and the suffix", () => {
    expect(combinePrompt("  A villa  ", "  8k  ")).toBe("A villa. 8k");
  });
});

describe("splitPrompts", () => {
  const arrayResponse = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it("parses a JSON array of { prompt, path } objects from the model response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      arrayResponse(
        JSON.stringify([
          { prompt: "a villa", path: "public/images/villa/01.jpg" },
          { prompt: "a pool", path: "public/images/villa/02.jpg" },
        ]),
      ),
    );
    const items = await splitPrompts(
      "a villa and a pool",
      { apiKey: "k" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(items).toEqual([
      { prompt: "a villa", path: "public/images/villa/01.jpg" },
      { prompt: "a pool", path: "public/images/villa/02.jpg" },
    ]);
  });

  it("parses a JSON array of { prompt, suffix } objects from the model response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      arrayResponse(
        JSON.stringify([
          { prompt: "a villa", suffix: "Photorealistic, 8k" },
          { prompt: "a pool", suffix: "Photorealistic, 8k" },
        ]),
      ),
    );
    const items = await splitPrompts("a villa and a pool", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(items).toEqual([
      { prompt: "a villa", suffix: "Photorealistic, 8k" },
      { prompt: "a pool", suffix: "Photorealistic, 8k" },
    ]);
  });

  it("omits path for entries the model didn't associate with one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      arrayResponse(JSON.stringify([{ prompt: "a cat" }, { prompt: "a dog" }])),
    );
    const items = await splitPrompts("a cat and a dog", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(items).toEqual([{ prompt: "a cat" }, { prompt: "a dog" }]);
  });

  it("tolerates a plain array of strings (no path) from the model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('["a cat", "a dog"]'));
    const items = await splitPrompts("a cat and a dog", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(items).toEqual([{ prompt: "a cat" }, { prompt: "a dog" }]);
  });

  it("extracts the array even with surrounding prose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('Sure!\n[{"prompt": "x"}, {"prompt": "y"}]\nDone.'));
    const items = await splitPrompts("x y", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(items).toEqual([{ prompt: "x" }, { prompt: "y" }]);
  });

  it("uses DEFAULT_SPLIT_MODEL when no model is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse(JSON.stringify([{ prompt: "a" }])));
    await splitPrompts("a", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("google/gemini-3.1-flash-lite-20260507");
  });

  it("surfaces the OpenRouter error message on a failed response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "google/foo is not a valid model ID" } }),
    });
    await expect(
      splitPrompts("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/not a valid model ID/);
  });

  it("sends a system instruction and the raw input as the user message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse(JSON.stringify([{ prompt: "a" }])));
    await splitPrompts("my messy text", { apiKey: "k", model: "m" }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toMatch(/Do NOT rewrite/);
    expect(body.messages[0].content).toMatch(/Never invent a path/);
    expect(body.messages[0].content).toMatch(/shared style or technical descriptor/);
    expect(body.messages[1]).toEqual({ role: "user", content: "my messy text" });
  });

  it("throws SplitError on unparseable output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse("no json here"));
    await expect(
      splitPrompts("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(SplitError);
  });

  it("throws SplitError when an array entry has no prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse(JSON.stringify([{ path: "a/01.jpg" }])));
    await expect(
      splitPrompts("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(SplitError);
  });

  it("throws SplitError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(
      splitPrompts("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(SplitError);
  });
});
