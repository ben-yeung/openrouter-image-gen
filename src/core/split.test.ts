import { describe, it, expect, vi } from "vitest";
import { splitPromptsLLM, batchLabel, SplitError } from "./split";

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
    expect(body.model).toBe("google/gemini-3.1-flash-lite-20260507");
  });

  it("surfaces the OpenRouter error message on a failed response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "google/foo is not a valid model ID" } }),
    });
    await expect(
      splitPromptsLLM("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/not a valid model ID/);
  });

  it("sends a system instruction and the raw input as the user message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('["a"]'));
    await splitPromptsLLM("my messy text", { apiKey: "k", model: "m" }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toMatch(/Do NOT rewrite/);
    expect(body.messages[1]).toEqual({ role: "user", content: "my messy text" });
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
