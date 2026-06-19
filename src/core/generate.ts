import type { GenerateParams, GeneratedImage } from "./types";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

function errorForStatus(status: number): string {
  switch (status) {
    case 401: return "Invalid or missing API key (401)";
    case 402: return "Insufficient credits (402)";
    case 429: return "Rate limited — slow down (429)";
    default: return `Request failed (${status})`;
  }
}

export async function generateImage(
  params: GenerateParams,
  fetchImpl: typeof fetch = fetch,
): Promise<GeneratedImage> {
  const index = params.index ?? 0;
  const base = { index, seed: params.seed, dataUrl: "" };
  try {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [{ role: "user", content: params.prompt }],
      modalities: ["image", "text"],
    };
    // TODO(modalities-per-model): some image-only models (e.g. Flux) may reject
    // ["image","text"] and need ["image"]. If a model returns a modality error,
    // retry with ["image"]. See spec §architecture. Anchor: src/core/generate.ts
    if (params.seed !== undefined) body.seed = params.seed;

    const res = await fetchImpl(COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) return { ...base, error: errorForStatus(res.status) };

    const data = await res.json();
    const url: string | undefined = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) {
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      return { ...base, error: text ? `No image returned: ${text}` : "No image returned" };
    }
    return { index, seed: params.seed, dataUrl: url };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function generateVariations(
  params: Omit<GenerateParams, "seed" | "index">,
  count: number,
  opts: { fetchImpl?: typeof fetch; baseSeed?: number } = {},
): Promise<GeneratedImage[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseSeed = opts.baseSeed ?? Math.floor(Math.random() * 1_000_000_000);
  const tasks = Array.from({ length: count }, (_, i) =>
    generateImage({ ...params, seed: baseSeed + i, index: i }, fetchImpl),
  );
  const settled = await Promise.allSettled(tasks);
  return settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { index: i, seed: baseSeed + i, dataUrl: "", error: String(r.reason) },
  );
}

/** Run thunks with bounded concurrency, preserving allSettled semantics. */
async function runThrottled<T>(
  thunks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(thunks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < thunks.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await thunks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  const poolSize = Math.max(1, Math.min(concurrency, thunks.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

/** One image per prompt, distinct seeds, throttled. Partial success allowed. */
export async function generateBatch(
  prompts: string[],
  params: Omit<GenerateParams, "prompt" | "seed" | "index">,
  opts: { fetchImpl?: typeof fetch; baseSeed?: number; concurrency?: number } = {},
): Promise<GeneratedImage[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseSeed = opts.baseSeed ?? Math.floor(Math.random() * 1_000_000_000);
  const concurrency = Math.max(5, Math.min(10, opts.concurrency ?? 6));

  const thunks = prompts.map((prompt, i) => () =>
    generateImage({ ...params, prompt, seed: baseSeed + i, index: i }, fetchImpl),
  );
  const settled = await runThrottled(thunks, concurrency);

  return settled.map((r, i) =>
    r.status === "fulfilled"
      ? { ...r.value, prompt: prompts[i] }
      : { index: i, seed: baseSeed + i, dataUrl: "", prompt: prompts[i], error: String(r.reason) },
  );
}
