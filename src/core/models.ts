import type { ImageModel } from "./types";

export const TOP_MODELS: ImageModel[] = [
  { id: "google/gemini-3.1-flash-image-preview", name: "Nano Banana 2", curated: true },
  { id: "google/gemini-3-pro-image-preview", name: "Nano Banana Pro", curated: true },
  { id: "sourceful/riverflow-2.5-pro", name: "Riverflow 2.5 Pro", curated: true },
  { id: "black-forest-labs/flux-1.1-pro", name: "FLUX 1.1 Pro", curated: true },
];

const MODELS_URL = "https://openrouter.ai/api/v1/models";

export function mergeModels(curated: ImageModel[], live: ImageModel[]): ImageModel[] {
  const liveById = new Map(live.map((m) => [m.id, m]));
  const curatedIds = new Set(curated.map((m) => m.id));
  const merged: ImageModel[] = curated.map((c) => ({
    ...c,
    name: liveById.get(c.id)?.name ?? c.name,
  }));
  for (const m of live) {
    if (!curatedIds.has(m.id)) merged.push(m);
  }
  return merged;
}

export async function fetchImageModels(fetchImpl: typeof fetch = fetch): Promise<ImageModel[]> {
  try {
    type RawModel = { id: string; name?: string; architecture?: { output_modalities?: string[] } };

    const res = await fetchImpl(MODELS_URL);
    if (!res.ok) return TOP_MODELS;
    const data = await res.json();
    const raw = (data?.data ?? []) as RawModel[];
    const live: ImageModel[] = raw
      .filter((m) => (m?.architecture?.output_modalities ?? []).includes("image"))
      .map((m) => ({ id: m.id, name: m.name ?? m.id, curated: false }));
    return mergeModels(TOP_MODELS, live);
  } catch {
    return TOP_MODELS;
  }
}
