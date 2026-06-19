import { DEFAULT_SPLIT_MODEL } from "./types";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

/**
 * Pure, no network. Detect the distinct prompts in structured input.
 * First matching strategy wins; returns [input] when it looks like one prompt,
 * [] when empty.
 */
export function splitPromptsHeuristic(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);

  // 1. Numbered items: "1." / "1)" / "1 -" / "1:"
  const numbered = lines
    .map((l) => l.match(/^\s*\d+\s*[.)\-:]\s+(.*\S)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
  if (numbered.length > 1) return numbered;

  // 2. Bullets: "-" / "*" / "•"
  const bullets = lines
    .map((l) => l.match(/^\s*[-*•]\s+(.*\S)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
  if (bullets.length > 1) return bullets;

  // 3. Blank-line-separated blocks
  const blocks = text
    .split(/\n\s*\n+/)
    .map((b) => b.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (blocks.length > 1) return blocks;

  // 4. Plain non-empty lines
  const plain = lines.map((l) => l.trim()).filter(Boolean);
  if (plain.length > 1) return plain;

  return [text];
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

/** Network fallback: ask a cheap text model for a JSON array of prompts. */
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
          {
            role: "system",
            content:
              "Split the user's text into the distinct image prompts it contains. " +
              "Return ONLY a JSON array of strings, one per prompt. " +
              "Do not rewrite, summarize, merge, or add prompts.",
          },
          { role: "user", content: input },
        ],
      }),
      signal: params.signal,
    });
  } catch (e) {
    throw new SplitError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw new SplitError(`AI split request failed (${res.status})`);
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  const prompts = parseJsonArray(content);
  if (!prompts || prompts.length === 0) {
    throw new SplitError("AI split didn't work — try editing your prompts manually.");
  }
  return prompts;
}
