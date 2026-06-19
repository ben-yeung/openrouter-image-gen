# OpenRouter Image Gen — Design Spec

**Date:** 2026-06-19
**Status:** Approved (brainstorming)

## Summary

A lightweight, locally-run tool for pay-as-you-go image generation through
OpenRouter, offered as two surfaces over one shared core:

1. A **Next.js + TypeScript + React** web app (single page).
2. An **interactive CLI** (menu-driven TUI).

Users bring their own OpenRouter API key (BYOK), pick a model from a live list
(or paste a custom model slug), enter a prompt, choose how many variations to
generate, and receive a gallery of images. Every generation is saved to disk as
a **folder-of-folders** (one subfolder per session) and is downloadable from the
web UI.

## Goals

- Minimal, modern, slim UI using Tailwind + **lucide-react** icons.
- True parity between web and CLI via a single shared `core/` module.
- BYOK: the user's key never leaves their machine; no shared secret, no auth, no
  billing layer.
- Every generation persists to `./generations/<session>/` with metadata.
- Multiple distinct variations per prompt, each reproducible via seed.

## Non-Goals (YAGNI)

- No user accounts, server-side auth, or hosted multi-tenant deployment. This is
  a locally-run tool; the Next.js server's filesystem **is** the repo.
- No shared/server OpenRouter key or billing layer.
- No cross-device history or database. Persistence is local disk only.
- No image editing / inpainting / img2img in this version (text-to-image only).

## Architecture (Approach A)

A single locally-run Next.js app (App Router) with a colocated, framework-agnostic
`core/` module and an interactive CLI bin. One `package.json`. Image generation
runs **client-side** in the browser (BYOK, direct to OpenRouter). A single
Next.js API route handles disk writes, reusing the same core save function the
CLI calls.

```
openrouter-image-gen/
  package.json            # scripts: dev, build, start, cli, test, lint
  next.config.ts  tsconfig.json  tailwind.config.ts
  .gitignore              # generations/, .env*, node_modules
  generations/            # OUTPUT: folder-of-folders (gitignored)
  src/
    core/                 # SHARED, framework-agnostic
      types.ts            # ImageModel, GenerateParams, GeneratedImage, Session
      models.ts           # fetchImageModels(), TOP_MODELS curated list, merge/fallback
      generate.ts         # generateImage(), generateVariations() — isomorphic fetch
      storage.ts          # saveSession() — NODE-ONLY (fs); used by CLI + API route
      slug.ts             # session-folder naming
      index.ts            # browser-safe barrel (DOES NOT export storage.ts)
    app/
      layout.tsx  page.tsx  globals.css
      api/sessions/route.ts   # POST: write images -> generations/<session>/
      components/             # ModelSelect, PromptForm, LoadingGrid, Gallery,
                              #   ImageCard, ApiKeyDialog
      lib/                    # useApiKey (localStorage), useGeneration hooks
  cli/
    index.ts              # @clack/prompts interactive TUI
    config.ts             # key from OPENROUTER_API_KEY env or local config file
```

### Stack

- Next.js + React + TypeScript (App Router)
- Tailwind CSS + **lucide-react** (slim / modern / minimal)
- `@clack/prompts` + `clipboardy` (CLI)
- `vitest` (tests)
- Raw `fetch` to OpenRouter — no SDK.

### The one structural invariant

`core/storage.ts` uses Node `fs` and is imported **only** by `cli/` and
`app/api/sessions/route.ts` — never by browser code. `core/index.ts` is the
browser-safe barrel and must not re-export `storage.ts`.

## Core module contracts

### `types.ts`

```ts
interface ImageModel {
  id: string;            // OpenRouter slug, e.g. "google/gemini-3.1-flash-image-preview"
  name: string;
  curated: boolean;      // true if from TOP_MODELS
  custom?: boolean;      // true if user-entered slug
}

interface GenerateParams {
  apiKey: string;
  model: string;
  prompt: string;
  seed?: number;         // best-effort; ignored by models without seed support
  signal?: AbortSignal;
}

interface GeneratedImage {
  dataUrl: string;       // data:image/png;base64,...
  seed?: number;
  index: number;
  error?: string;        // set when this variation failed (partial success)
}

interface Session {
  sessionId: string;
  prompt: string;
  model: string;
  count: number;
  createdAt: string;     // ISO
  images: { file: string; seed?: number }[];
}
```

### `models.ts`

- `TOP_MODELS: ImageModel[]` — curated, ordered list of well-known image models
  (e.g. Nano Banana 2 `google/gemini-3.1-flash-image-preview`, Nano Banana Pro,
  Riverflow 2.5, Flux). Maintained by hand; used for ordering and as fallback.
- `fetchImageModels(): Promise<ImageModel[]>` — GET
  `https://openrouter.ai/api/v1/models` (public, no key required), filter to
  models whose output modalities include `"image"`. Merge: curated entries first
  (in curated order), then remaining live image models. On fetch failure, return
  `TOP_MODELS` as fallback.

### `generate.ts` (isomorphic)

- `generateImage(params: GenerateParams): Promise<GeneratedImage>` — POST
  `https://openrouter.ai/api/v1/chat/completions` with body:
  ```jsonc
  {
    "model": params.model,
    "messages": [{ "role": "user", "content": params.prompt }],
    "modalities": ["image", "text"],
    "seed": params.seed        // omitted if undefined
  }
  ```
  Parse `choices[0].message.images[0].image_url.url` (base64 data URL). If no
  image is present (text-only refusal), return a `GeneratedImage` with `error`
  set.
  <!-- TODO(modalities-per-model): some image-only models (e.g. Flux) may reject
       modalities:["image","text"] and require ["image"]. If a model errors on the
       combined modalities, retry with ["image"]. Track per-model modality needs
       in TOP_MODELS metadata if this proves common. Anchor: core/generate.ts -->
- `generateVariations(params, count): Promise<GeneratedImage[]>` — fire `count`
  parallel `generateImage` calls, **each assigned a distinct seed**
  (`baseSeed + i`, baseSeed random per batch). Uses `Promise.allSettled` so one
  failure does not abort the batch (partial success: failed variations come back
  with `error` set, successful ones with `dataUrl`). Seeds are best-effort:
  passed when set, harmlessly ignored by models that don't support them.

### `slug.ts`

- `sessionFolderName(prompt: string, date: Date): string` — returns
  `YYYY-MM-DD_HHmmss__<slug(prompt)>-<shortid>`. Prompt slug is lowercased,
  non-alphanumerics collapsed to `-`, truncated (~40 chars). `shortid` is a short
  random suffix guaranteeing uniqueness.

### `storage.ts` (Node-only)

- `saveSession(input: { prompt; model; images: GeneratedImage[]; rootDir? })
  : Promise<{ dir: string; session: Session }>` — create
  `<rootDir|"./generations">/<sessionFolderName>/`, write each successful image as
  `NN.png` (zero-padded, decoded from its data URL), write `metadata.json`
  (the `Session` object). Skips/records failed variations. Returns the absolute
  folder path and the session manifest.

## Data flow

### Web

1. User sets OpenRouter key → stored in `localStorage` (`useApiKey`).
2. On load, `fetchImageModels()` populates `ModelSelect` (combobox); a custom-slug
   field lets the user enter any model id.
3. User types a prompt and picks a variation count (1–8).
4. **Generate** → `useGeneration` calls `generateVariations()` directly from the
   browser (N parallel OpenRouter requests with distinct seeds).
5. `LoadingGrid` shows skeletons; `Gallery` renders each image as its request
   resolves (partial results appear progressively).
6. Browser POSTs the resulting images + prompt + model to `/api/sessions`; the
   route calls `saveSession()` and returns the folder path. UI shows
   "Saved to `generations/<session>/`".
7. Each `ImageCard` has a `Download` button; the gallery has a "download all"
   action.

### CLI

Same `generate.ts`, then calls `saveSession()` directly. Produces byte-identical
output to the web app.

## Folder-of-folders format

```
generations/
  2026-06-19_143000__a-cat-in-space-x7k2/
    01.png
    02.png
    metadata.json
```

`metadata.json`:
```json
{
  "sessionId": "x7k2",
  "prompt": "a cat in space",
  "model": "google/gemini-3.1-flash-image-preview",
  "count": 2,
  "createdAt": "2026-06-19T14:30:00.000Z",
  "images": [
    { "file": "01.png", "seed": 48213 },
    { "file": "02.png", "seed": 48214 }
  ]
}
```

Root defaults to `./generations/` (gitignored). The CLI may override the root via
flag/config.

## Web UI

Single page, minimal:

- **Top bar:** title + key/settings button (lucide `Settings` / `KeyRound`).
- **Control panel:** model combobox (live list + custom-slug field), prompt
  `textarea`, variation stepper (1–8), `Sparkles` Generate button.
- **Results grid:** responsive; skeletons while loading, then `ImageCard`s with
  `Download` buttons and a `DownloadCloud` "download all". Shows the saved folder
  path once persisted.
- **ApiKeyDialog:** capture/update the key (stored in `localStorage`).

## CLI (interactive TUI, `@clack/prompts`)

- `intro` → ensure key: read `OPENROUTER_API_KEY` env, else local config file,
  else prompt the user and offer to save it.
- Main menu loop: **Generate** / change model / set variations / settings / exit.
- Generate flow: prompt input (type, or "paste from clipboard" via `clipboardy`)
  → model select (live list + custom slug) → variation count → spinner during
  generation → `saveSession()` → print saved path + summary → back to menu.

## Error handling

- Per-variation isolation via `Promise.allSettled`: partial success allowed —
  show images that succeeded, flag the ones that failed.
- Missing/invalid key (401) → prompt to set/fix the key.
- Insufficient credits / rate limit (402 / 429) → clear, specific message.
- Model returned text-only / refusal (no image in response) → surface the
  assistant text as the variation's error.
- Network / timeout → variation marked failed; batch continues.
- Save failure (API route) → toast; images remain in the gallery for manual
  download.

## Testing

Vitest, TDD on the core modules:

- `models.ts` — filter image-output models, curated merge ordering, fallback on
  fetch failure (mocked `fetch`).
- `generate.ts` — parse `message.images`, distinct-seed assignment, partial
  failure via `Promise.allSettled`, text-only/no-image handling (mocked `fetch`).
- `slug.ts` — folder-name format, slugging, uniqueness suffix.
- `storage.ts` — folder creation, `NN.png` decoding/writing, `metadata.json`
  contents, skipping failed variations (writes to a temp dir).

Web components and the CLI are tested lightly.

## Defaults

- Variation cap: **8**.
- Output directory: **`./generations/`** (gitignored).
- CLI key storage: local config file when the user opts to save; otherwise read
  from `OPENROUTER_API_KEY`.
- Requested modalities: `["image", "text"]` (see TODO(modalities-per-model)).
