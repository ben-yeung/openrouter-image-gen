# OpenRouter Image Gen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight, locally-run BYOK image generator over OpenRouter with two surfaces — a Next.js web app and an interactive CLI — sharing one core module, saving every generation to a folder-of-folders on disk.

**Architecture:** A single Next.js (App Router) project. A framework-agnostic `src/core/` holds isomorphic OpenRouter logic (model list + generation) plus a Node-only filesystem `storage.ts`. The browser generates images client-side (BYOK) and POSTs results to one API route that writes them via `storage.ts`; the CLI calls `storage.ts` directly. Both produce identical output.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript 5, Tailwind CSS + lucide-react, @clack/prompts + clipboardy (CLI), nanoid, vitest (+ jsdom for hook tests). Raw `fetch` to OpenRouter — no SDK.

## Global Constraints

- BYOK only: the user's OpenRouter key never goes to any shared server. Web stores it in `localStorage`; CLI reads `OPENROUTER_API_KEY` env or a local config file.
- `src/core/storage.ts` uses Node `fs` and MUST be imported only by `cli/` and `src/app/api/sessions/route.ts`. `src/core/index.ts` is the browser-safe barrel and MUST NOT re-export `storage.ts`.
- Output root defaults to `./generations/` (gitignored). Folder name format: `YYYY-MM-DD_HHmmss__<slug(prompt)>-<shortid>`.
- OpenRouter endpoints: models `GET https://openrouter.ai/api/v1/models` (public, no key); generation `POST https://openrouter.ai/api/v1/chat/completions` with `modalities: ["image","text"]`; images returned at `choices[0].message.images[0].image_url.url` as a base64 data URL.
- Variations: each variation is one parallel request with a distinct seed (`baseSeed + i`). Variation cap: 8.
- Partial success is allowed: one failed variation must not abort the batch.
- Text-to-image only. No accounts, no DB, no shared key.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore` | Project config + scripts |
| `src/core/types.ts` | Shared TypeScript types |
| `src/core/slug.ts` | `shortId`, `slugify`, `sessionFolderName` |
| `src/core/models.ts` | `TOP_MODELS`, `mergeModels`, `fetchImageModels` |
| `src/core/generate.ts` | `generateImage`, `generateVariations` (isomorphic) |
| `src/core/storage.ts` | `saveSession` (Node-only) |
| `src/core/index.ts` | Browser-safe barrel (excludes storage) |
| `src/app/api/sessions/route.ts` | `POST` → write session to disk |
| `src/app/lib/useApiKey.ts` | localStorage key hook |
| `src/app/lib/useGeneration.ts` | client generation orchestration |
| `src/app/components/*.tsx` | UI: ModelSelect, PromptForm, LoadingGrid, Gallery, ImageCard, ApiKeyDialog |
| `src/app/page.tsx`, `layout.tsx`, `globals.css` | Web shell |
| `cli/config.ts` | CLI key load/save |
| `cli/index.ts` | Interactive TUI |

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm run dev`, `npm test`, `npm run typecheck`; path alias `@/* → ./src/*`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "openrouter-image-gen",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "cli": "tsx cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "next lint"
  },
  "dependencies": {
    "@clack/prompts": "^0.7.0",
    "clipboardy": "^4.0.0",
    "lucide-react": "^0.469.0",
    "nanoid": "^5.0.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create config files**

`next.config.ts`:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

`tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: { environment: "node", globals: true },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

`.gitignore`:
```
node_modules/
.next/
generations/
.env*
*.tsbuildinfo
next-env.d.ts
.openrouter-image-gen.json
```

- [ ] **Step 4: Create the web shell**

`src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }
body { @apply bg-neutral-950 text-neutral-100 antialiased; }
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Image Gen",
  description: "Pay-as-you-go image generation via OpenRouter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` (placeholder, replaced in Task 8):
```tsx
export default function Home() {
  return <main className="p-8">Image Gen</main>;
}
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: completes without errors; `node_modules/` populated.

- [ ] **Step 6: Verify dev server and tooling**

Run: `npm run typecheck`
Expected: PASS (no type errors).

Run: `npx vitest run` (no tests yet)
Expected: exits 0 with "no test files found".

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + TS + Tailwind + vitest project"
```

---

## Task 2: Core types + slug

**Files:**
- Create: `src/core/types.ts`, `src/core/slug.ts`
- Test: `src/core/slug.test.ts`

**Interfaces:**
- Consumes: `nanoid`.
- Produces:
  - `ImageModel`, `GenerateParams`, `GeneratedImage`, `Session` (types).
  - `shortId(): string` (4-char a-z0-9).
  - `slugify(prompt: string, max?: number): string`.
  - `sessionFolderName(prompt: string, date?: Date, id?: string): string`.

- [ ] **Step 1: Write `src/core/types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test `src/core/slug.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { slugify, sessionFolderName, shortId } from "./slug";

describe("slugify", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugify("A Cat in Space!")).toBe("a-cat-in-space");
  });
  it("truncates to max length without trailing dash", () => {
    expect(slugify("x".repeat(100), 5)).toBe("xxxxx");
    expect(slugify("aa bb cc dd", 6)).toBe("aa-bb");
  });
  it("falls back to 'image' for empty input", () => {
    expect(slugify("!!!")).toBe("image");
  });
});

describe("shortId", () => {
  it("returns a 4-char lowercase alphanumeric id", () => {
    expect(shortId()).toMatch(/^[a-z0-9]{4}$/);
  });
});

describe("sessionFolderName", () => {
  it("formats as date_time__slug-id", () => {
    const d = new Date(2026, 5, 19, 14, 30, 0); // 2026-06-19 14:30:00 local
    expect(sessionFolderName("a cat", d, "x7k2")).toBe("2026-06-19_143000__a-cat-x7k2");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/slug.test.ts`
Expected: FAIL — cannot import from `./slug`.

- [ ] **Step 4: Write `src/core/slug.ts`**

```ts
import { customAlphabet } from "nanoid";

export const shortId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4);

export function slugify(prompt: string, max = 40): string {
  const s = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = (s || "image").slice(0, max).replace(/-+$/g, "");
  return truncated || "image";
}

export function sessionFolderName(prompt: string, date = new Date(), id = shortId()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}__${slugify(prompt)}-${id}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/slug.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/slug.ts src/core/slug.test.ts
git commit -m "feat(core): add shared types and slug/session-folder naming"
```

---

## Task 3: Model list (fetch + merge + fallback)

**Files:**
- Create: `src/core/models.ts`
- Test: `src/core/models.test.ts`

**Interfaces:**
- Consumes: `ImageModel` from `./types`.
- Produces:
  - `TOP_MODELS: ImageModel[]`.
  - `mergeModels(curated: ImageModel[], live: ImageModel[]): ImageModel[]`.
  - `fetchImageModels(fetchImpl?: typeof fetch): Promise<ImageModel[]>`.

- [ ] **Step 1: Write the failing test `src/core/models.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchImageModels, mergeModels, TOP_MODELS } from "./models";

describe("mergeModels", () => {
  it("puts curated first, then non-curated live models, deduped by id", () => {
    const curated = [{ id: "a/b", name: "Curated B", curated: true }];
    const live = [
      { id: "a/b", name: "Live B", curated: false },
      { id: "c/d", name: "Live D", curated: false },
    ];
    const merged = mergeModels(curated, live);
    expect(merged.map((m) => m.id)).toEqual(["a/b", "c/d"]);
    expect(merged[0].curated).toBe(true);
    expect(merged[0].name).toBe("Live B"); // prefers live name
  });
});

describe("fetchImageModels", () => {
  it("filters to models with image output and merges with curated", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "x/text-only", name: "T", architecture: { output_modalities: ["text"] } },
          { id: "x/img", name: "Img", architecture: { output_modalities: ["image", "text"] } },
        ],
      }),
    });
    const models = await fetchImageModels(fakeFetch as unknown as typeof fetch);
    expect(models.some((m) => m.id === "x/img")).toBe(true);
    expect(models.some((m) => m.id === "x/text-only")).toBe(false);
  });

  it("falls back to TOP_MODELS on fetch failure", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("network"));
    const models = await fetchImageModels(fakeFetch as unknown as typeof fetch);
    expect(models).toEqual(TOP_MODELS);
  });

  it("falls back to TOP_MODELS on non-ok response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const models = await fetchImageModels(fakeFetch as unknown as typeof fetch);
    expect(models).toEqual(TOP_MODELS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/models.test.ts`
Expected: FAIL — cannot import from `./models`.

- [ ] **Step 3: Write `src/core/models.ts`**

```ts
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
    const res = await fetchImpl(MODELS_URL);
    if (!res.ok) return TOP_MODELS;
    const data = await res.json();
    const live: ImageModel[] = (data?.data ?? [])
      .filter((m: any) => (m?.architecture?.output_modalities ?? []).includes("image"))
      .map((m: any) => ({ id: m.id as string, name: (m.name ?? m.id) as string, curated: false }));
    return mergeModels(TOP_MODELS, live);
  } catch {
    return TOP_MODELS;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/models.ts src/core/models.test.ts
git commit -m "feat(core): image model list with live fetch, merge and fallback"
```

---

## Task 4: Image generation (isomorphic)

**Files:**
- Create: `src/core/generate.ts`
- Test: `src/core/generate.test.ts`

**Interfaces:**
- Consumes: `GenerateParams`, `GeneratedImage` from `./types`.
- Produces:
  - `generateImage(params: GenerateParams, fetchImpl?: typeof fetch): Promise<GeneratedImage>`.
  - `generateVariations(params: Omit<GenerateParams, "seed" | "index">, count: number, opts?: { fetchImpl?: typeof fetch; baseSeed?: number }): Promise<GeneratedImage[]>`.

- [ ] **Step 1: Write the failing test `src/core/generate.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { generateImage, generateVariations } from "./generate";

const imageResponse = (url: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: "ok", images: [{ image_url: { url } }] } }] }),
});

describe("generateImage", () => {
  it("returns the data URL from message.images", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const img = await generateImage(
      { apiKey: "k", model: "m", prompt: "p", index: 0, seed: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(img.dataUrl).toBe("data:image/png;base64,AAA");
    expect(img.seed).toBe(5);
    expect(img.error).toBeUndefined();
  });

  it("sends seed and bearer auth in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    await generateImage(
      { apiKey: "secret", model: "m", prompt: "p", seed: 9 },
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const body = JSON.parse(init.body as string);
    expect(body.seed).toBe(9);
    expect(body.modalities).toEqual(["image", "text"]);
  });

  it("returns an error for 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const img = await generateImage(
      { apiKey: "k", model: "m", prompt: "p" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(img.error).toMatch(/401/);
    expect(img.dataUrl).toBe("");
  });

  it("returns an error when no image is present (text-only)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "I can't do that" } }] }),
    });
    const img = await generateImage(
      { apiKey: "k", model: "m", prompt: "p" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(img.error).toMatch(/can't do that/);
  });
});

describe("generateVariations", () => {
  it("fires N requests with distinct sequential seeds and indexes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const imgs = await generateVariations(
      { apiKey: "k", model: "m", prompt: "p" },
      3,
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 100 },
    );
    expect(imgs).toHaveLength(3);
    expect(imgs.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(imgs.map((i) => i.seed)).toEqual([100, 101, 102]);
  });

  it("allows partial success (one failure does not abort the batch)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse("data:image/png;base64,AAA"))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const imgs = await generateVariations(
      { apiKey: "k", model: "m", prompt: "p" },
      2,
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 0 },
    );
    expect(imgs.filter((i) => i.dataUrl)).toHaveLength(1);
    expect(imgs.filter((i) => i.error)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/generate.test.ts`
Expected: FAIL — cannot import from `./generate`.

- [ ] **Step 3: Write `src/core/generate.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/generate.ts src/core/generate.test.ts
git commit -m "feat(core): isomorphic image generation with per-variation seeds"
```

---

## Task 5: Storage (Node-only) + browser-safe barrel

**Files:**
- Create: `src/core/storage.ts`, `src/core/index.ts`
- Test: `src/core/storage.test.ts`

**Interfaces:**
- Consumes: `GeneratedImage`, `Session` from `./types`; `sessionFolderName`, `shortId` from `./slug`.
- Produces:
  - `saveSession(input: { prompt: string; model: string; images: GeneratedImage[]; rootDir?: string; now?: Date }): Promise<{ dir: string; session: Session }>`.
  - `src/core/index.ts` re-exports types, models, generate, slug (NOT storage).

- [ ] **Step 1: Write the failing test `src/core/storage.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSession } from "./storage";
import type { GeneratedImage } from "./types";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "imggen-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const png = (b64: string): GeneratedImage => ({ index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1 });

describe("saveSession", () => {
  it("writes images as NN.png and a metadata.json manifest", async () => {
    const aaa = Buffer.from("hello").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "a cat",
      model: "m",
      images: [{ ...png(aaa), index: 0, seed: 10 }, { ...png(aaa), index: 1, seed: 11 }],
      rootDir: root,
      now: new Date(2026, 5, 19, 14, 30, 0),
    });

    const files = (await fs.readdir(dir)).sort();
    expect(files).toEqual(["01.png", "02.png", "metadata.json"]);
    expect(session.count).toBe(2);
    expect(session.images).toEqual([
      { file: "01.png", seed: 10 },
      { file: "02.png", seed: 11 },
    ]);

    const written = await fs.readFile(path.join(dir, "01.png"));
    expect(written.toString()).toBe("hello");

    const meta = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
    expect(meta.prompt).toBe("a cat");
    expect(meta.model).toBe("m");
  });

  it("skips failed variations", async () => {
    const aaa = Buffer.from("x").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "p",
      model: "m",
      images: [
        { index: 0, dataUrl: `data:image/png;base64,${aaa}`, seed: 1 },
        { index: 1, dataUrl: "", error: "boom", seed: 2 },
      ],
      rootDir: root,
    });
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".png"));
    expect(files).toEqual(["01.png"]);
    expect(session.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/storage.test.ts`
Expected: FAIL — cannot import from `./storage`.

- [ ] **Step 3: Write `src/core/storage.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { sessionFolderName, shortId } from "./slug";
import type { GeneratedImage, Session } from "./types";

export async function saveSession(input: {
  prompt: string;
  model: string;
  images: GeneratedImage[];
  rootDir?: string;
  now?: Date;
}): Promise<{ dir: string; session: Session }> {
  const id = shortId();
  const now = input.now ?? new Date();
  const root = input.rootDir ?? path.resolve(process.cwd(), "generations");
  const dir = path.join(root, sessionFolderName(input.prompt, now, id));
  await fs.mkdir(dir, { recursive: true });

  const successful = input.images.filter((img) => img.dataUrl && !img.error);
  const images: Session["images"] = [];
  let n = 1;
  for (const img of successful) {
    const file = `${String(n).padStart(2, "0")}.png`;
    const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    await fs.writeFile(path.join(dir, file), Buffer.from(base64, "base64"));
    images.push({ file, seed: img.seed });
    n++;
  }

  const session: Session = {
    sessionId: id,
    prompt: input.prompt,
    model: input.model,
    count: images.length,
    createdAt: now.toISOString(),
    images,
  };
  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(session, null, 2));
  return { dir, session };
}
```

- [ ] **Step 4: Write `src/core/index.ts` (browser-safe barrel — NO storage)**

```ts
export * from "./types";
export * from "./models";
export * from "./generate";
export * from "./slug";
// NOTE: storage.ts is intentionally NOT exported — it is Node-only.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm test`
Expected: PASS (slug, models, generate, storage).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/storage.ts src/core/index.ts src/core/storage.test.ts
git commit -m "feat(core): filesystem session storage + browser-safe barrel"
```

---

## Task 6: Session save API route

**Files:**
- Create: `src/app/api/sessions/route.ts`
- Test: `src/app/api/sessions/route.test.ts`

**Interfaces:**
- Consumes: `saveSession` from `@/core/storage`.
- Produces: `POST` handler accepting `{ prompt, model, images }`, returning `{ dir, session }` (200) or `{ error }` (400/500).

- [ ] **Step 1: Write the failing test `src/app/api/sessions/route.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "imggen-route-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("POST /api/sessions", () => {
  it("saves images and returns the session", async () => {
    const { POST } = await import("./route");
    const b64 = Buffer.from("img").toString("base64");
    const req = new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        prompt: "a cat",
        model: "m",
        images: [{ index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1 }],
      }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.count).toBe(1);
    expect(json.dir).toContain(path.join(root, "generations"));
  });

  it("returns 400 when prompt or images are missing", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ model: "m" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/sessions/route.test.ts`
Expected: FAIL — cannot import `./route`.

- [ ] **Step 3: Write `src/app/api/sessions/route.ts`**

```ts
import { NextResponse } from "next/server";
import { saveSession } from "@/core/storage";
import type { GeneratedImage } from "@/core/types";

export const runtime = "nodejs";

interface SaveBody {
  prompt?: string;
  model?: string;
  images?: GeneratedImage[];
}

export async function POST(req: Request) {
  try {
    const { prompt, model, images } = (await req.json()) as SaveBody;
    if (!prompt || !model || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "prompt, model and images are required" },
        { status: 400 },
      );
    }
    const { dir, session } = await saveSession({ prompt, model, images });
    return NextResponse.json({ dir, session });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/sessions/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sessions/route.ts src/app/api/sessions/route.test.ts
git commit -m "feat(web): /api/sessions route writes generations to disk"
```

---

## Task 7: Web hooks (key + generation orchestration)

**Files:**
- Create: `src/app/lib/useApiKey.ts`, `src/app/lib/useGeneration.ts`
- Test: `src/app/lib/useApiKey.test.ts`

**Interfaces:**
- Consumes: `generateVariations` from `@/core` (browser-safe barrel), `GeneratedImage`, `ImageModel`.
- Produces:
  - `useApiKey(): { apiKey: string; setApiKey: (k: string) => void; clear: () => void }` (localStorage-backed).
  - `useGeneration(): { images: GeneratedImage[]; loading: boolean; savedDir: string | null; error: string | null; run: (args: { apiKey: string; model: string; prompt: string; count: number }) => Promise<void> }`.

- [ ] **Step 1: Write the failing test `src/app/lib/useApiKey.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useApiKey } from "./useApiKey";

beforeEach(() => localStorage.clear());

describe("useApiKey", () => {
  it("persists the key to localStorage and reads it back", () => {
    const { result } = renderHook(() => useApiKey());
    expect(result.current.apiKey).toBe("");
    act(() => result.current.setApiKey("sk-test"));
    expect(result.current.apiKey).toBe("sk-test");
    expect(localStorage.getItem("openrouter_api_key")).toBe("sk-test");
  });

  it("clears the key", () => {
    const { result } = renderHook(() => useApiKey());
    act(() => result.current.setApiKey("sk-test"));
    act(() => result.current.clear());
    expect(result.current.apiKey).toBe("");
    expect(localStorage.getItem("openrouter_api_key")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/lib/useApiKey.test.ts`
Expected: FAIL — cannot import `./useApiKey`.

- [ ] **Step 3: Write `src/app/lib/useApiKey.ts`**

```ts
"use client";
import { useEffect, useState } from "react";

const KEY = "openrouter_api_key";

export function useApiKey() {
  const [apiKey, setKey] = useState("");

  useEffect(() => {
    setKey(localStorage.getItem(KEY) ?? "");
  }, []);

  const setApiKey = (k: string) => {
    localStorage.setItem(KEY, k);
    setKey(k);
  };
  const clear = () => {
    localStorage.removeItem(KEY);
    setKey("");
  };

  return { apiKey, setApiKey, clear };
}
```

- [ ] **Step 4: Write `src/app/lib/useGeneration.ts`**

```ts
"use client";
import { useState } from "react";
import { generateVariations, type GeneratedImage } from "@/core";

export function useGeneration() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedDir, setSavedDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(args: { apiKey: string; model: string; prompt: string; count: number }) {
    setLoading(true);
    setError(null);
    setSavedDir(null);
    setImages([]);
    try {
      const results = await generateVariations(
        { apiKey: args.apiKey, model: args.model, prompt: args.prompt },
        args.count,
      );
      setImages(results);

      const successful = results.filter((r) => r.dataUrl && !r.error);
      if (successful.length > 0) {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: args.prompt, model: args.model, images: successful }),
        });
        if (res.ok) {
          const json = await res.json();
          setSavedDir(json.dir);
        } else {
          setError("Images generated but could not be saved to disk.");
        }
      } else {
        setError(results[0]?.error ?? "No images were generated.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return { images, loading, savedDir, error, run };
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/app/lib/useApiKey.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/lib/useApiKey.ts src/app/lib/useGeneration.ts src/app/lib/useApiKey.test.ts
git commit -m "feat(web): localStorage key hook and generation orchestration hook"
```

---

## Task 8: Web UI (components + page)

**Files:**
- Create: `src/app/components/ApiKeyDialog.tsx`, `src/app/components/ModelSelect.tsx`, `src/app/components/PromptForm.tsx`, `src/app/components/LoadingGrid.tsx`, `src/app/components/ImageCard.tsx`, `src/app/components/Gallery.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `useApiKey`, `useGeneration`, `fetchImageModels`, `TOP_MODELS`, `ImageModel`, `GeneratedImage`.
- Produces: working single-page UI. No new exported core APIs.

- [ ] **Step 1: Write `src/app/components/ApiKeyDialog.tsx`**

```tsx
"use client";
import { useState } from "react";
import { KeyRound, X } from "lucide-react";

export function ApiKeyDialog({
  initial, onSave, onClose,
}: { initial: string; onSave: (k: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <KeyRound className="h-4 w-4" /> OpenRouter API key
          </h2>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-sm text-neutral-400">
          Stored only in your browser. Get one at openrouter.ai/keys.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-or-..."
          className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          onClick={() => { onSave(value.trim()); onClose(); }}
          className="w-full rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/components/ModelSelect.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { fetchImageModels, TOP_MODELS, type ImageModel } from "@/core";

export function ModelSelect({
  value, onChange,
}: { value: string; onChange: (id: string) => void }) {
  const [models, setModels] = useState<ImageModel[]>(TOP_MODELS);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    fetchImageModels().then(setModels).catch(() => setModels(TOP_MODELS));
  }, []);

  useEffect(() => {
    if (!value && models.length) onChange(models[0].id);
  }, [models, value, onChange]);

  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wide text-neutral-500">Model</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.curated ? "★ " : ""}{m.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="custom/model-slug"
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="button"
          onClick={() => custom.trim() && onChange(custom.trim())}
          className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
        >
          Use
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/app/components/PromptForm.tsx`**

```tsx
"use client";
import { Sparkles } from "lucide-react";
import { ModelSelect } from "./ModelSelect";

export function PromptForm({
  prompt, setPrompt, model, setModel, count, setCount, disabled, onGenerate,
}: {
  prompt: string; setPrompt: (v: string) => void;
  model: string; setModel: (v: string) => void;
  count: number; setCount: (n: number) => void;
  disabled: boolean; onGenerate: () => void;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
      <ModelSelect value={model} onChange={setModel} />
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-neutral-500">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="A serene mountain lake at dawn, cinematic lighting…"
          className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-neutral-500">Variations</label>
          <input
            type="number" min={1} max={8} value={count}
            onChange={(e) => setCount(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
            className="w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>
        <button
          onClick={onGenerate}
          disabled={disabled}
          className="flex items-center gap-2 rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" /> Generate
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/app/components/LoadingGrid.tsx`**

```tsx
export function LoadingGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-xl bg-neutral-800" />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `src/app/components/ImageCard.tsx`**

```tsx
"use client";
import { Download, ImageOff } from "lucide-react";
import type { GeneratedImage } from "@/core";

export function ImageCard({ image }: { image: GeneratedImage }) {
  if (image.error || !image.dataUrl) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-center text-xs text-neutral-500">
        <ImageOff className="h-5 w-5" />
        <span>{image.error ?? "Failed"}</span>
      </div>
    );
  }
  return (
    <div className="group relative overflow-hidden rounded-xl border border-neutral-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt="" className="aspect-square w-full object-cover" />
      <a
        href={image.dataUrl}
        download={`image-${image.index + 1}.png`}
        className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs opacity-0 transition group-hover:opacity-100"
      >
        <Download className="h-3.5 w-3.5" /> Save
      </a>
    </div>
  );
}
```

- [ ] **Step 6: Write `src/app/components/Gallery.tsx`**

```tsx
"use client";
import { DownloadCloud } from "lucide-react";
import type { GeneratedImage } from "@/core";
import { ImageCard } from "./ImageCard";

export function Gallery({ images }: { images: GeneratedImage[] }) {
  const ok = images.filter((i) => i.dataUrl && !i.error);
  const downloadAll = () => {
    ok.forEach((img) => {
      const a = document.createElement("a");
      a.href = img.dataUrl;
      a.download = `image-${img.index + 1}.png`;
      a.click();
    });
  };
  return (
    <div className="space-y-3">
      {ok.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={downloadAll}
            className="flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
          >
            <DownloadCloud className="h-3.5 w-3.5" /> Download all
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((img) => (
          <ImageCard key={img.index} image={img} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Replace `src/app/page.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Settings, KeyRound } from "lucide-react";
import { useApiKey } from "./lib/useApiKey";
import { useGeneration } from "./lib/useGeneration";
import { ApiKeyDialog } from "./components/ApiKeyDialog";
import { PromptForm } from "./components/PromptForm";
import { LoadingGrid } from "./components/LoadingGrid";
import { Gallery } from "./components/Gallery";

export default function Home() {
  const { apiKey, setApiKey } = useApiKey();
  const { images, loading, savedDir, error, run } = useGeneration();
  const [showKey, setShowKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [count, setCount] = useState(4);

  const onGenerate = () => {
    if (!apiKey) return setShowKey(true);
    if (prompt.trim() && model) run({ apiKey, model, prompt: prompt.trim(), count });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Image Gen</h1>
        <button
          onClick={() => setShowKey(true)}
          className="flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-800"
        >
          {apiKey ? <Settings className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          {apiKey ? "Settings" : "Set key"}
        </button>
      </header>

      <PromptForm
        prompt={prompt} setPrompt={setPrompt}
        model={model} setModel={setModel}
        count={count} setCount={setCount}
        disabled={loading} onGenerate={onGenerate}
      />

      <section className="mt-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {savedDir && (
          <p className="mb-4 text-xs text-neutral-500">Saved to {savedDir}</p>
        )}
        {loading ? <LoadingGrid count={count} /> : <Gallery images={images} />}
      </section>

      {showKey && (
        <ApiKeyDialog initial={apiKey} onSave={setApiKey} onClose={() => setShowKey(false)} />
      )}
    </main>
  );
}
```

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds (compiles the app and the `/api/sessions` route).

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, open http://localhost:3000.
Verify: header "Set key" → enter an OpenRouter key → enter a prompt, pick a model, set variations to 2 → Generate → skeletons appear, then images render; "Saved to …generations/…" appears; a `generations/<session>/` folder with `01.png`, `02.png`, `metadata.json` exists; per-image "Save" and "Download all" work.

- [ ] **Step 10: Commit**

```bash
git add src/app/components src/app/page.tsx
git commit -m "feat(web): minimal generation UI (form, gallery, key dialog)"
```

---

## Task 9: Interactive CLI

**Files:**
- Create: `cli/config.ts`, `cli/index.ts`
- Test: `cli/config.test.ts`

**Interfaces:**
- Consumes: `generateVariations` (from `../src/core/generate`), `fetchImageModels`, `TOP_MODELS` (`../src/core/models`), `saveSession` (`../src/core/storage`).
- Produces:
  - `loadKey(): string | null` (env `OPENROUTER_API_KEY`, else config file).
  - `saveKey(key: string): void` (writes config file).
  - `configPath(): string`.

- [ ] **Step 1: Write the failing test `cli/config.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "imggen-cfg-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

describe("cli config", () => {
  it("prefers the env var", async () => {
    process.env.OPENROUTER_API_KEY = "env-key";
    const { loadKey } = await import("./config");
    expect(loadKey()).toBe("env-key");
  });

  it("round-trips a saved key via the config file", async () => {
    const { saveKey, loadKey } = await import("./config");
    saveKey("file-key");
    expect(loadKey()).toBe("file-key");
  });

  it("returns null when nothing is set", async () => {
    const { loadKey } = await import("./config");
    expect(loadKey()).toBeNull();
  });
});
```

Note: `config.ts` must read the file synchronously at call time (not cache module-level) so the mocked `homedir` is honored.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/config.test.ts`
Expected: FAIL — cannot import `./config`.

- [ ] **Step 3: Write `cli/config.ts`**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function configPath(): string {
  return path.join(os.homedir(), ".openrouter-image-gen.json");
}

export function loadKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.apiKey ?? null;
  } catch {
    return null;
  }
}

export function saveKey(key: string): void {
  fs.writeFileSync(configPath(), JSON.stringify({ apiKey: key }, null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `cli/index.ts`**

```ts
import {
  intro, outro, text, select, confirm, password, spinner, isCancel, cancel, note,
} from "@clack/prompts";
import clipboard from "clipboardy";
import { loadKey, saveKey } from "./config.js";
import { fetchImageModels, TOP_MODELS } from "../src/core/models.js";
import { generateVariations } from "../src/core/generate.js";
import { saveSession } from "../src/core/storage.js";

function bail(value: unknown): asserts value {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

async function ensureKey(): Promise<string> {
  const existing = loadKey();
  if (existing) return existing;
  const key = await password({ message: "OpenRouter API key:" });
  bail(key);
  const save = await confirm({ message: "Save this key for next time?" });
  bail(save);
  if (save) saveKey(key as string);
  return key as string;
}

async function generateFlow(apiKey: string) {
  const source = await select({
    message: "Prompt input:",
    options: [
      { value: "type", label: "Type a prompt" },
      { value: "clip", label: "Paste from clipboard" },
    ],
  });
  bail(source);

  let prompt: string;
  if (source === "clip") {
    prompt = (await clipboard.read()).trim();
    note(prompt || "(clipboard empty)", "Clipboard");
  } else {
    const typed = await text({ message: "Describe the image:" });
    bail(typed);
    prompt = (typed as string).trim();
  }
  if (!prompt) { note("Empty prompt — skipping.", "Skip"); return; }

  const models = await fetchImageModels().catch(() => TOP_MODELS);
  const model = await select({
    message: "Model:",
    options: [
      ...models.map((m) => ({ value: m.id, label: `${m.curated ? "★ " : ""}${m.name}` })),
      { value: "__custom__", label: "Custom slug…" },
    ],
  });
  bail(model);

  let modelId = model as string;
  if (modelId === "__custom__") {
    const slug = await text({ message: "Custom model slug:" });
    bail(slug);
    modelId = (slug as string).trim();
  }

  const countRaw = await text({ message: "Variations (1-8):", initialValue: "4" });
  bail(countRaw);
  const count = Math.min(8, Math.max(1, Number(countRaw) || 1));

  const s = spinner();
  s.start(`Generating ${count} image(s)…`);
  const images = await generateVariations({ apiKey, model: modelId, prompt }, count);
  const ok = images.filter((i) => i.dataUrl && !i.error);
  s.stop(`Generated ${ok.length}/${count}.`);

  const failed = images.filter((i) => i.error);
  if (failed.length) note(failed.map((f) => `#${f.index + 1}: ${f.error}`).join("\n"), "Errors");

  if (ok.length === 0) return;
  const { dir } = await saveSession({ prompt, model: modelId, images });
  note(dir, "Saved");
}

async function main() {
  intro("OpenRouter Image Gen");
  const apiKey = await ensureKey();

  for (;;) {
    const action = await select({
      message: "What now?",
      options: [
        { value: "gen", label: "Generate images" },
        { value: "exit", label: "Exit" },
      ],
    });
    bail(action);
    if (action === "exit") break;
    if (action === "gen") await generateFlow(apiKey);
  }

  outro("Done.");
}

main();
```

Note on imports: under `tsx`, ESM-style `.js` specifiers resolve to the sibling `.ts` sources. Keep the `.js` suffixes so the same code also works if compiled.

- [ ] **Step 6: Run config test + typecheck**

Run: `npx vitest run cli/config.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Run: `npm run cli`
Verify: prompts for key (or reads env), main menu appears; "Generate images" → type a prompt → pick a model → set variations to 2 → spinner → "Saved <path>"; a `generations/<session>/` folder with PNGs + `metadata.json` exists. Try "Paste from clipboard" with text copied. Ctrl-C cancels cleanly.

- [ ] **Step 8: Commit**

```bash
git add cli/config.ts cli/index.ts cli/config.test.ts
git commit -m "feat(cli): interactive TUI for image generation"
```

---

## Task 10: Docs + final verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything. Produces: nothing.

- [ ] **Step 1: Write `README.md`**

```markdown
# OpenRouter Image Gen

Lightweight, BYOK pay-as-you-go image generation via OpenRouter — web app + interactive CLI sharing one core. Every generation is saved to `./generations/<session>/`.

## Setup
\`\`\`bash
npm install
\`\`\`

## Web
\`\`\`bash
npm run dev      # http://localhost:3000
\`\`\`
Enter your OpenRouter key (stored only in your browser), pick a model (or paste a custom slug), write a prompt, choose variations, Generate. Images render in the gallery and are written to `generations/`.

## CLI
\`\`\`bash
npm run cli
\`\`\`
Reads `OPENROUTER_API_KEY` (or prompts and optionally saves to `~/.openrouter-image-gen.json`). Menu-driven: prompt input (typed or from clipboard), model select, variation count.

## How it works
- BYOK: your key never goes to a shared server. The browser calls OpenRouter directly; a local API route only writes files.
- Each variation is one parallel request with a distinct seed (recorded in `metadata.json` for reproducibility).

## Test
\`\`\`bash
npm test
\`\`\`
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: ALL tests pass (slug, models, generate, storage, route, useApiKey, config).

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Self-Review

**Spec coverage:**
- BYOK key handling → Task 7 (`useApiKey`), Task 9 (`config`). ✓
- Shared core + web + CLI parity → Tasks 2–5 core, 8 web, 9 CLI. ✓
- Live model fetch + curated fallback + custom slug → Task 3 (`fetchImageModels`/`mergeModels`), Task 8/9 (custom slug UI). ✓
- Direct-from-browser generation → Task 7 (`useGeneration` calls `generateVariations` client-side). ✓
- Distinct seed per variation + reproducible metadata → Task 4 (seeds), Task 5 (metadata records seed). ✓
- Folder-of-folders persistence → Task 5 (`saveSession`), Task 6 (route), Task 9 (CLI direct). ✓
- Loading state → Task 8 (`LoadingGrid`). ✓
- Gallery + per-image + download-all → Task 8 (`Gallery`/`ImageCard`). ✓
- Partial success / error handling → Task 4 (`Promise.allSettled`, status messages), Task 8 (error UI). ✓
- Node-only storage isolation invariant → Task 5 (barrel excludes storage; route/CLI import storage directly). ✓
- Slim/modern/minimal + lucide icons → Task 8 (Tailwind, lucide-react). ✓
- Testing (vitest, TDD core) → Tasks 2–7, 9 have failing-test-first cycles. ✓

**Placeholder scan:** No "TBD/TODO-as-gap". The single `TODO(modalities-per-model)` in Task 4 is an intentional forward-looking stub per spec, with full surrounding implementation present. ✓

**Type consistency:** `GeneratedImage` (index/dataUrl/seed/error), `Session` (sessionId/prompt/model/count/createdAt/images[{file,seed}]), `generateVariations(params, count, opts)`, `saveSession({prompt,model,images,rootDir?,now?})`, `fetchImageModels(fetchImpl?)`, `useGeneration().run({apiKey,model,prompt,count})` — names/signatures match across producing and consuming tasks. ✓
