# Prompt Splitting — Design Spec

**Date:** 2026-06-19
**Status:** Approved (brainstorming)
**Builds on:** [2026-06-19-openrouter-image-gen-design.md](./2026-06-19-openrouter-image-gen-design.md)

> **Revision 2026-06-19:** Dropped the heuristic/newline splitter
> (`splitPromptsHeuristic`) — line breaks are an unreliable signal. Splitting is
> now **LLM-only**: an explicit "Split into separate prompts" control opens a
> confirmation (web modal `SplitConfirmModal` / CLI confirm) that runs the split
> model to extract each prompt **verbatim**. Sections below reflect this; the
> `generateBatch`/storage/settings design is unchanged.

## Summary

A prompt-intelligence layer that sits in front of image generation. When the user
provides freeform input that contains **multiple distinct prompts**
(e.g. "I have 10 prompts for artworks…"), the app decomposes it into a list of
individual prompts and generates **one image per prompt** — a *batch*. Splitting
is **opt-in**: the app detects a candidate multi-prompt input, shows the parsed
list, and the user reviews/edits and confirms before anything is generated.

This is **split only** — the user's words are never rewritten or enhanced. It
assumes the user has structured their input into distinct, clear prompts; the
review/confirm step is the safety net for any mis-split.

## Goals

- Turn one structured multi-prompt input into N parallel single-image generations.
- Opt-in via a review/confirm gate that always shows the **total request count**
  (with a visible warning when large), since each request spends the user's BYOK
  credits.
- Extraction is done **entirely by a cheap LLM** (the split model). There is no
  heuristic/newline splitting — line breaks are an unreliable signal. The user
  triggers it explicitly (a "Split into separate prompts" button → confirmation),
  and the model extracts each distinct prompt verbatim.
- True web/CLI parity, reusing the shared `core/` module.
- Persist a batch to disk in the existing folder format, extended so each image
  records its own prompt.

## Non-Goals (YAGNI)

- No prompt enhancement, rewriting, expansion, style presets, or negative prompts.
- No per-prompt variation counts — split mode is exactly one image per prompt.
  (The existing "N variations of one prompt" path is unchanged and separate.)
- No hard cap on batch size — the total-count display + warning is the guardrail.
- No mixing of variations and splitting in a single action.

## Design decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Scope | Split only; no rewriting/enhancement |
| Trigger | Opt-in; user reviews/edits the extracted list before generating |
| Detection | **LLM-only** — split model extracts prompts verbatim; no heuristic/newline splitting |
| P × V | **1 image per prompt**; variations control hidden/ignored in split mode |
| Storage | **One flat batch folder**; each image's prompt recorded in `metadata.json` |
| Concurrency | Throttle 5–10 in-flight (default 6); no hard cap |
| Cost guard | Always show total request count; highlight when N ≥ 12 |
| Split model | Default `google/gemini-3.1-flash-lite-20260507`; persisted + user-editable |

## Architecture

Additive to the existing single Next.js app. One new core module (`split.ts`),
one new core generation function (`generateBatch`), small type/storage
extensions, and UI/CLI additions. The browser-safe-barrel invariant is preserved
(`split.ts` is isomorphic — no `fs` — and may be exported from `core/index.ts`).

```
src/core/
  split.ts        # NEW: splitPromptsLLM (LLM extraction), batchLabel, SplitError
  generate.ts     # + generateBatch(); shared throttled runner
  types.ts        # GeneratedImage.prompt?, Session.kind, DEFAULT_SPLIT_MODEL
  storage.ts      # saveSession persists per-image prompt + batch label
  index.ts        # + export split.ts (isomorphic, browser-safe)
src/app/
  lib/useSplit.ts         # NEW: LLM extraction wrapper for the web
  components/SplitConfirmModal.tsx  # NEW: confirm using the split model before extracting
  lib/useGeneration.ts    # extended to accept a prompt list (batch)
  lib/useSettings.ts      # NEW (or extend useApiKey): persist splitModel
  components/SplitReview.tsx   # NEW: editable parsed-prompt list + count/warning
cli/
  config.ts       # + splitModel load/save
  index.ts        # split detection + review/confirm in generateFlow
```

## Core module contracts

### `split.ts` (isomorphic)

```ts
// Network. Asks the split model for a strict JSON array of prompt strings.
// Parses defensively; throws SplitError on request failure or unparseable output.
splitPromptsLLM(
  input: string,
  params: { apiKey: string; model?: string; signal?: AbortSignal },
  fetchImpl?: typeof fetch,
): Promise<string[]>

batchLabel(prompts: string[]): string

class SplitError extends Error {}
```

**LLM extraction** — `POST https://openrouter.ai/api/v1/chat/completions` with a
system instruction that tells the model to extract each distinct image prompt
**verbatim** (preserve wording; no rewriting, rephrasing, expanding, summarizing,
merging, or inventing; light cleanup of list markers/quotes/whitespace only; do
not copy shared context into individual prompts; exclude greetings and meta
commentary), and to return ONLY a JSON array of strings (a single-element array
for one image, `[]` for none). `model = params.model ?? <persisted split model>`.
Parse: locate the first `[`…`]`, `JSON.parse`, validate it's a string array,
trim + drop empties. On request failure or unparseable/empty output throw
`SplitError`. The full system prompt lives in `src/core/split.ts`
(`SPLIT_SYSTEM_PROMPT`).

**Trigger rule (consumers):** there is no automatic detection. The user clicks a
"Split into separate prompts" control; a confirmation (web modal / CLI confirm)
explains the call uses the split model, and on confirm `splitPromptsLLM` runs and
its result populates the editable review list.

### `generate.ts` — batch generation

```ts
generateBatch(
  prompts: string[],
  params: Omit<GenerateParams, "prompt" | "seed" | "index">,
  opts?: { fetchImpl?: typeof fetch; baseSeed?: number; concurrency?: number },
): Promise<GeneratedImage[]>
```

- One `generateImage` per prompt, **distinct seed** (`baseSeed + i`, `baseSeed`
  random per batch), `index = i`, and the per-prompt `prompt` recorded on the
  result.
- **Throttled** to `concurrency` in-flight (default **6**; clamp 5–10) via a
  small async pool — queued, not fire-all-at-once. Preserves `Promise.allSettled`
  partial-success semantics (a failed prompt comes back with `error` set; the
  batch continues).
- `generateVariations` is unchanged. Both MAY share an internal `runThrottled`
  helper to avoid duplicating the pool.

### `types.ts`

```ts
interface GeneratedImage {
  index: number;
  dataUrl: string;
  seed?: number;
  prompt?: string;   // NEW: the prompt that produced this image (batch mode)
  error?: string;
}

interface Session {
  sessionId: string;
  prompt: string;            // batch label in batch mode (see below)
  model: string;
  count: number;
  createdAt: string;
  kind: "variations" | "batch";   // NEW
  images: { file: string; seed?: number; prompt?: string }[];  // + prompt
}

export const DEFAULT_SPLIT_MODEL = "google/gemini-3.1-flash-lite-20260507";  // NEW
```

### `storage.ts`

`saveSession` extended: accepts `kind` and a per-image `prompt`. For a batch:

- **Batch label** (top-level `Session.prompt`): the first prompt truncated, plus
  `" +N more"` when N > 1 (e.g. `"a cat in space +9 more"`). The session **folder
  name** is derived from this label's slug (reusing `sessionFolderName`).
- Writes images flat as `NN.png`; each `images[]` entry records `{ file, seed,
  prompt }`. `kind: "batch"`.
- Variations mode is unchanged: `kind: "variations"`, no per-image `prompt`.

## Data flow

### Web

1. User types/pastes input in `PromptForm`. Whenever the prompt is non-empty, a
   **"Split into separate prompts"** button appears (no automatic detection).
2. Clicking it opens **`SplitConfirmModal`**, which names the split model and
   explains it will make one extraction call. (No key → open the key dialog
   first.) On confirm, `splitPromptsLLM` runs (modal shows an "Extracting…"
   state); on failure the modal closes and an inline error is shown.
3. On success the extracted prompts populate **`SplitReview`**: an editable list
   (edit / remove / add row) showing **"This will generate N images (N
   requests)"**, highlighted (red) when **N ≥ 12**.
4. Confirm → `useGeneration` calls `generateBatch` (throttled, client-side, BYOK)
   → gallery renders one card per prompt, each captioned with its prompt;
   partial results stream in as they resolve.
5. Browser POSTs `{ kind: "batch", model, images:[{...,prompt}] }` to
   `/api/sessions`; the route calls `saveSession`. UI shows the saved folder path.

### CLI

In `generateFlow`, after capturing the prompt text: `confirm` "Extract multiple
prompts from this text using `<split model>`?" (defaults to no). On yes, a
spinner runs `splitPromptsLLM`; the extracted prompts are listed via `note`, then
`confirm` "Generate these N as separate images? (N requests)". On confirm →
`generateBatch` → `saveSession({ kind: "batch", … })`. On extraction failure,
`note` the error and fall through to the normal single-prompt variations flow.

## Settings: persisted split model

- Constant default `DEFAULT_SPLIT_MODEL = "google/gemini-3.1-flash-lite-20260507"`
  (must be a valid OpenRouter model id; verified against the live catalog).
- **Web:** stored in `localStorage` (key `openrouter_split_model`) via a small
  `useSettings` hook (or an extension of `useApiKey`); editable in the existing
  settings/key dialog.
- **CLI:** `config.ts` gains `loadSplitModel()` / `saveSplitModel()` reading the
  same `~/.openrouter-image-gen.json` file (`splitModel` field), with a menu
  option to change it. Falls back to `DEFAULT_SPLIT_MODEL` when unset.

## Folder-of-folders format (batch)

```
generations/
  2026-06-19_143000__a-cat-in-space-9-more-x7k2/
    01.png
    02.png
    …
    metadata.json
```

`metadata.json`:
```json
{
  "sessionId": "x7k2",
  "prompt": "a cat in space +9 more",
  "model": "google/gemini-3.1-flash-image-preview",
  "count": 10,
  "createdAt": "2026-06-19T14:30:00.000Z",
  "kind": "batch",
  "images": [
    { "file": "01.png", "seed": 48213, "prompt": "a cat in space" },
    { "file": "02.png", "seed": 48214, "prompt": "a dog on the moon" }
  ]
}
```

## Error handling

- Per-prompt isolation via `Promise.allSettled` (existing): one failed prompt is
  flagged in its gallery card; the batch completes.
- `splitPromptsLLM` failure → `SplitError`; the web closes the confirm modal and
  shows an inline error, the CLI `note`s the error and falls through to the
  single-prompt flow. The user can edit their text and retry.
- Throttling reduces 429s; an individual 429 is still surfaced per-prompt
  (existing `errorForStatus`).
- Large-batch cost: the total-request count is always shown pre-generation and
  highlighted at N ≥ 12; the confirm gate is the user's stop point.

## Testing (Vitest, TDD)

- **`split.test.ts`** — `splitPromptsLLM`: JSON-array parse, array extraction
  from surrounding prose, default-model use, system+user message shape, defensive
  `SplitError` on bad/non-ok output (mocked `fetch`); `batchLabel` formatting.
- **`generate.test.ts`** — `generateBatch`: one request per prompt, distinct
  sequential seeds, per-image `prompt` attached, throttle respects max in-flight
  (assert peak concurrency ≤ N), partial success on one failure.
- **`storage.test.ts`** — batch save writes per-image `prompt` and `kind:"batch"`
  into `metadata.json`; batch-label folder naming.
- **`config.test.ts`** — `splitModel` round-trips; falls back to
  `DEFAULT_SPLIT_MODEL` when unset.
- Web components tested lightly: `SplitReview` (count display + warning
  threshold, add/edit/remove rows) and `SplitConfirmModal` (model name shown,
  confirm/cancel callbacks, loading disables actions).

## Defaults

- Split model: **`google/gemini-3.1-flash-lite-20260507`** (persisted, editable).
- Concurrency: **6** in-flight (clamp 5–10).
- Large-batch warning threshold: **N ≥ 12**.
- Batch size: **no hard cap** (count display + warning is the guard).
- One image per split prompt; variations control hidden in split mode.
