import { DEFAULT_SPLIT_MODEL } from "./types";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

/** Human-readable label for a batch: first prompt (truncated) + "+N more". */
export function batchLabel(prompts: string[]): string {
  const first = prompts[0] ?? "batch";
  const head = first.length > 40 ? `${first.slice(0, 40).trimEnd()}…` : first;
  return prompts.length > 1 ? `${head} +${prompts.length - 1} more` : head;
}

function parseJsonArray(content: string | undefined): string[] | null {
  if (!content) return null;
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const arr: unknown = JSON.parse(content.slice(start, end + 1));
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return (arr as string[]).map((s) => s.trim()).filter(Boolean);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * System instruction for the extraction model. Verbatim extraction only —
 * the model identifies the distinct image prompts and returns them as written,
 * without rewriting, merging, or injecting shared context.
 */
const SPLIT_SYSTEM_PROMPT = [
  "You extract distinct image-generation prompts from a user's text for a batch image generator.",
  "",
  "The text may list several image requests using numbering, bullets, quotes, or plain sentences,",
  "possibly mixed with commentary or instructions addressed to you. Identify each distinct image",
  "the user wants generated.",
  "",
  "Return ONLY a JSON array of strings — no prose, no explanation, no markdown, no code fences.",
  "",
  "Guidelines:",
  "- One array element per distinct image prompt, in the order they appear.",
  "- Preserve each prompt's original wording. Do NOT rewrite, rephrase, translate, expand,",
  "  summarize, improve, or combine prompts, and do NOT invent prompts that are not present.",
  '- Light cleanup only: strip list markers (e.g. "1.", "2)", "-", "*"), surrounding quotation',
  "  marks, and leading/trailing whitespace.",
  "- Do NOT copy shared context (a common style, count, or instruction) into the individual",
  "  prompts; keep each prompt's own text only.",
  "- Exclude text that is not itself an image prompt: greetings, meta commentary, and instructions",
  '  to you (e.g. "I have 10 prompts", "make them detailed").',
  "- If the text describes only one image, return a single-element array.",
  "- If you find no image prompts, return an empty array.",
].join("\n");

/**
 * Ask the configured split model to extract the distinct image prompts from
 * free-form text. This is the only splitting path — there is no heuristic
 * fallback. Throws SplitError on request failure or unparseable output.
 */
export async function splitPromptsLLM(
  input: string,
  params: { apiKey: string; model?: string; signal?: AbortSignal },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const model = params.model ?? DEFAULT_SPLIT_MODEL;
  let res: Response;
  try {
    res = await fetchImpl(COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SPLIT_SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
      }),
      signal: params.signal,
    });
  } catch (e) {
    throw new SplitError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw new SplitError(`Prompt extraction failed (${res.status})`);
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  const prompts = parseJsonArray(content);
  if (!prompts || prompts.length === 0) {
    throw new SplitError("Couldn't extract any prompts — try editing your text and retry.");
  }
  return prompts;
}
