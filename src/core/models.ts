import type { ImageModel } from "./types";

const SLUG_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(:[a-zA-Z0-9._-]+)?$/;

export function isValidSlugFormat(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export type SlugStatus = "idle" | "invalid" | "valid";

export function evaluateSlug(
  draft: string,
  allIds: Set<string>,
  hasCatalog: boolean,
): { status: SlugStatus; commit: boolean } {
  if (!draft) return { status: "idle", commit: false };
  if (!isValidSlugFormat(draft)) return { status: "invalid", commit: false };
  if (!hasCatalog) return { status: "valid", commit: true };
  if (allIds.has(draft)) return { status: "valid", commit: true };
  return { status: "invalid", commit: false };
}

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

export interface ModelCatalog {
  imageModels: ImageModel[];
  allIds: Set<string>;
}

type RawModel = { id: string; name?: string; architecture?: { output_modalities?: string[] } };

export async function fetchModelCatalog(fetchImpl: typeof fetch = fetch): Promise<ModelCatalog> {
  try {
    const res = await fetchImpl(MODELS_URL);
    if (!res.ok) return { imageModels: TOP_MODELS, allIds: new Set() };
    const data = await res.json();
    const raw = (data?.data ?? []) as RawModel[];
    const allIds = new Set(raw.map((m) => m.id));
    const live: ImageModel[] = raw
      .filter((m) => (m?.architecture?.output_modalities ?? []).includes("image"))
      .map((m) => ({ id: m.id, name: m.name ?? m.id, curated: false }));
    return { imageModels: mergeModels(TOP_MODELS, live), allIds };
  } catch {
    return { imageModels: TOP_MODELS, allIds: new Set() };
  }
}

export async function fetchImageModels(fetchImpl: typeof fetch = fetch): Promise<ImageModel[]> {
  return (await fetchModelCatalog(fetchImpl)).imageModels;
}
