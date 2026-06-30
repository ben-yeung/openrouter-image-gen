import { DEFAULT_SPLIT_MODEL } from "./types";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

export interface SplitItem {
  prompt: string;
  path?: string;   // output name/path the input associates with this prompt, if any
  suffix?: string; // shared style/technical text appended to this prompt at generation time, if any
}

/** Human-readable label for a batch: first prompt (truncated) + "+N more". */
export function batchLabel(prompts: string[]): string {
  const first = prompts[0] ?? "batch";
  const head = first.length > 40 ? `${first.slice(0, 40).trimEnd()}…` : first;
  return prompts.length > 1 ? `${head} +${prompts.length - 1} more` : head;
}

/**
 * Joins a prompt's scene description with its style suffix (if any) the way
 * the original combined prompt would have read — used right before
 * generation, after the review step. Adds sentence-ending punctuation
 * between the two when the prompt doesn't already end with some.
 */
export function combinePrompt(prompt: string, suffix?: string): string {
  const trimmedPrompt = prompt.trim();
  const trimmedSuffix = suffix?.trim();
  if (!trimmedSuffix) return trimmedPrompt;
  const sep = /[.!?]$/.test(trimmedPrompt) ? " " : ". ";
  return `${trimmedPrompt}${sep}${trimmedSuffix}`;
}

function parseSplitItems(content: string | undefined): SplitItem[] | null {
  if (!content) return null;
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const arr: unknown = JSON.parse(content.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const items: SplitItem[] = [];
    for (const entry of arr) {
      if (typeof entry === "string") {
        const prompt = entry.trim();
        if (prompt) items.push({ prompt });
        continue;
      }
      if (!entry || typeof entry !== "object") return null;
      const { prompt, path, suffix } = entry as Record<string, unknown>;
      if (typeof prompt !== "string" || !prompt.trim()) return null;
      items.push({
        prompt: prompt.trim(),
        ...(typeof path === "string" && path.trim() ? { path: path.trim() } : {}),
        ...(typeof suffix === "string" && suffix.trim() ? { suffix: suffix.trim() } : {}),
      });
    }
    return items;
  } catch {
    return null;
  }
}

/**
 * System instruction for the extraction model. Verbatim prompt extraction —
 * the model identifies the distinct image prompts and returns them as
 * written, without rewriting, merging, or injecting shared context. It also
 * infers any output name/path the input itself associates with each prompt,
 * and any shared style/technical suffix meant to apply to every prompt, from
 * whatever structure is present (JSON, a table, numbered filenames, key-value
 * lines, etc.) — never inventing either for inputs that don't have one.
 */
const SPLIT_SYSTEM_PROMPT = [
  "You extract distinct image-generation prompts from a user's text for a batch image generator.",
  "",
  "The input may be free-form text listing several image requests (numbering, bullets, quotes,",
  "plain sentences), or it may be structured data (JSON, a table, key-value lines, numbered file",
  "names, etc.) that pairs each prompt with an associated output name, path, or identifier, and/or",
  "a shared style or technical suffix meant to be appended to every prompt.",
  "Identify each distinct image the user wants generated, in the order they appear.",
  "",
  "Return ONLY a JSON array — no prose, no explanation, no markdown, no code fences. Each element",
  'is an object of the form {"prompt": "...", "path": "...", "suffix": "..."}.',
  "",
  "Guidelines:",
  "- One array element per distinct image prompt.",
  "- Preserve each prompt's original wording. Do NOT rewrite, rephrase, translate, expand,",
  "  summarize, improve, or combine prompts, and do NOT invent prompts that are not present.",
  '- Light cleanup only: strip list markers (e.g. "1.", "2)", "-", "*"), surrounding quotation',
  "  marks, and leading/trailing whitespace from the prompt text.",
  '- Include "suffix" when the input has a shared style or technical descriptor meant to apply to',
  '  every prompt — e.g. a dedicated field (such as "styleSuffix", "style", or "suffix"), or text',
  "  that's identical or near-identical across multiple prompts (typically trailing camera/lighting/",
  '  quality boilerplate). Put that shared text in "suffix" and strip it back out of "prompt" so it',
  '  isn\'t duplicated. Omit "suffix" when no such shared text exists. Never invent a suffix that',
  "  isn't present in the input.",
  "- Beyond a detected suffix, do NOT copy other shared context (a common count or instruction) into",
  "  the individual prompts; keep each prompt's own scene-specific text only.",
  '- Include "path" only when the input itself logically associates that prompt with a file name,',
  '  path, or other naming identifier (e.g. a JSON "path"/"file"/"filename" field, a numbered image',
  "  name, a row label in a table). Omit \"path\" entirely for an entry when the input doesn't",
  "  associate one with it. Never invent a path that isn't present in the input.",
  "- Exclude text that is not itself an image prompt: greetings, meta commentary, and instructions",
  '  to you (e.g. "I have 10 prompts", "make them detailed").',
  "- If the text describes only one image, return a single-element array.",
  "- If you find no image prompts, return an empty array.",
].join("\n");

/**
 * Ask the configured split model to extract the distinct image prompts from
 * the input, along with any output name/path the input itself associates
 * with each one. This is the only splitting path — there is no
 * format-specific deterministic parser; pairing is always inferred by the
 * model from whatever structure the input has. Throws SplitError on request
 * failure or unparseable output.
 */
export async function splitPrompts(
  input: string,
  params: { apiKey: string; model?: string; signal?: AbortSignal },
  fetchImpl: typeof fetch = fetch,
): Promise<SplitItem[]> {
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

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      const msg = errBody?.error?.message ?? errBody?.message;
      if (typeof msg === "string" && msg.trim()) detail = `: ${msg.trim()}`;
    } catch {
      // body wasn't JSON — fall back to the bare status
    }
    throw new SplitError(`Prompt extraction failed (${res.status})${detail}`);
  }
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  const items = parseSplitItems(content);
  if (!items || items.length === 0) {
    throw new SplitError("Couldn't extract any prompts — try editing your text and retry.");
  }
  return items;
}
