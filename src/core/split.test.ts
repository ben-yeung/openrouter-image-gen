import { describe, it, expect, vi } from "vitest";
import {
  splitPromptsHeuristic,
  splitPromptsLLM,
  batchLabel,
  SplitError,
} from "./split";

describe("splitPromptsHeuristic", () => {
  it("splits numbered lists and strips the markers", () => {
    expect(splitPromptsHeuristic("1. a cat\n2. a dog\n3. a bird")).toEqual([
      "a cat",
      "a dog",
      "a bird",
    ]);
  });

  it("splits 1) and 1 - numbering too", () => {
    expect(splitPromptsHeuristic("1) red car\n2) blue car")).toEqual(["red car", "blue car"]);
  });

  it("splits bullet lists", () => {
    expect(splitPromptsHeuristic("- a cat\n- a dog")).toEqual(["a cat", "a dog"]);
  });

  it("splits blank-line-separated blocks", () => {
    expect(splitPromptsHeuristic("a cat in space\n\na dog on the moon")).toEqual([
      "a cat in space",
      "a dog on the moon",
    ]);
  });

  it("splits plain newline-separated lines", () => {
    expect(splitPromptsHeuristic("a cat\na dog")).toEqual(["a cat", "a dog"]);
  });

  it("returns a single-element array for one prompt", () => {
    expect(splitPromptsHeuristic("just one prompt please")).toEqual(["just one prompt please"]);
  });

  it("returns [] for empty input", () => {
    expect(splitPromptsHeuristic("   ")).toEqual([]);
  });
});

describe("batchLabel", () => {
  it("labels a multi-prompt batch with '+N more'", () => {
    expect(batchLabel(["a cat in space", "a dog", "a bird"])).toBe("a cat in space +2 more");
  });
  it("returns the single prompt unchanged when there is one", () => {
    expect(batchLabel(["a cat"])).toBe("a cat");
  });
});

describe("splitPromptsLLM", () => {
  const arrayResponse = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it("parses a JSON array from the model response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('["a cat", "a dog"]'));
    const prompts = await splitPromptsLLM(
      "a cat and a dog",
      { apiKey: "k" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(prompts).toEqual(["a cat", "a dog"]);
  });

  it("extracts the array even with surrounding prose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('Sure!\n["x", "y"]\nDone.'));
    const prompts = await splitPromptsLLM("x y", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(prompts).toEqual(["x", "y"]);
  });

  it("uses DEFAULT_SPLIT_MODEL when no model is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('["a"]'));
    await splitPromptsLLM("a", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("google/gemini-3.1-flash");
  });

  it("throws SplitError on unparseable output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse("no json here"));
    await expect(
      splitPromptsLLM("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(SplitError);
  });

  it("throws SplitError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(
      splitPromptsLLM("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(SplitError);
  });
});
