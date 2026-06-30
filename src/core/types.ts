export interface ImageModel {
  id: string;        // OpenRouter slug
  name: string;
  curated: boolean;
  custom?: boolean;
}

export interface GenerateParams {
  apiKey: string;
  model: string;
  prompt: string;
  seed?: number;
  index?: number;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  index: number;
  dataUrl: string;   // "" when error is set or still pending
  seed?: number;
  prompt?: string;   // the prompt that produced this image (batch mode)
  path?: string;      // requested output path/name (batch mode, structured input)
  pending?: boolean;  // slot is still generating (optimistic placeholder, no result yet)
  error?: string;
}

export interface Session {
  sessionId: string;
  prompt: string;            // batch label when kind === "batch"
  model: string;
  count: number;
  createdAt: string;         // ISO
  kind: "variations" | "batch";
  images: { file: string; seed?: number; prompt?: string }[];
}

// Cheap, low-latency text model used to extract individual prompts. Must be a
// valid OpenRouter model id (verified present in the live catalog). User-editable
// in settings, so a future deprecation can be worked around without a code change.
export const DEFAULT_SPLIT_MODEL = "google/gemini-3.1-flash-lite-20260507";
