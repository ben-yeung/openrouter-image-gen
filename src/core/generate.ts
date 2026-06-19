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
    return { ...base, error: (e as Error).message };
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
