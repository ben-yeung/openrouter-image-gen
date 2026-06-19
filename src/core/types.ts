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
  dataUrl: string;   // "" when error is set
  seed?: number;
  prompt?: string;   // the prompt that produced this image (batch mode)
  error?: string;
}

export interface Session {
  sessionId: string;
  prompt: string;
  model: string;
  count: number;
  createdAt: string; // ISO
  images: { file: string; seed?: number }[];
}

export const DEFAULT_SPLIT_MODEL = "google/gemini-3.1-flash";
