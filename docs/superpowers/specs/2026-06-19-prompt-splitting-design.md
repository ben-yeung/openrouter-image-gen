# Prompt Splitting — Design Spec

**Date:** 2026-06-19
**Status:** Approved (brainstorming)
**Builds on:** [2026-06-19-openrouter-image-gen-design.md](./2026-06-19-openrouter-image-gen-design.md)

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
- Two-tier detection: fast, free **heuristic** splitting first; a cheap **LLM
  fallback** ("AI split") for messy single-block prose.
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
| Trigger | Opt-in; user reviews/edits the parsed list before generating |
| Detection | Heuristic first; LLM fallback ("AI split") for single-block input |
| P × V | **1 image per prompt**; variations control hidden/ignored in split mode |
| Storage | **One flat batch folder**; each image's prompt recorded in `metadata.json` |
| Concurrency | Throttle 5–10 in-flight (default 6); no hard cap |
| Cost guard | Always show total request count; highlight when N ≥ 12 |
| Split model | Default `google/gemini-3.1-flash`; persisted + user-editable |

## Architecture

Additive to the existing single Next.js app. One new core module (`split.ts`),
one new core generation function (`generateBatch`), small type/storage
extensions, and UI/CLI additions. The browser-safe-barrel invariant is preserved
(`split.ts` is isomorphic — no `fs` — and may be exported from `core/index.ts`).

```
src/core/
  split.ts        # NEW: splitPromptsHeuristic (pure), splitPromptsLLM (network)
  generate.ts     # + generateBatch(); shared throttled runner
  types.ts        # GeneratedImage.prompt?, Session.kind, DEFAULT_SPLIT_MODEL
  storage.ts      # saveSession persists per-image prompt + batch label
  index.ts        # + export split.ts (isomorphic, browser-safe)
src/app/
  lib/useSplit.ts         # NEW: heuristic + LLM split for the web
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
// Pure, no network. Returns one entry per detected prompt.
// If the input resolves to a single block, returns [input] (→ no auto-split).
splitPromptsHeuristic(input: string): string[]

// Network. Asks a cheap text model for a strict JSON array of prompt strings.
// Parses defensively; throws SplitError on unparseable output.
splitPromptsLLM(
  input: string,
  params: { apiKey: string; model?: string; signal?: AbortSignal },
  fetchImpl?: typeof fetch,
): Promise<string[]>

class SplitError extends Error {}
```

**Heuristic algorithm** (first matching strategy wins):

1. **Numbered items** — lines beginning `1.`, `1)`, `1 -`, `1:` (and 2, 3, …).
2. **Bullets** — lines beginning `-`, `*`, or `•`.
3. **Blank-line blocks** — split on one-or-more blank lines.
4. **Plain newlines** — non-empty lines, each a prompt.

For every strategy: strip the leading marker, `trim()`, drop empties. Then
**collapse**: if the result has length ≤ 1, fall through to the next strategy;
if all strategies yield ≤ 1, return `[input]` (single prompt — no split offered).

**LLM fallback** — `POST https://openrouter.ai/api/v1/chat/completions` with a
small system instruction ("Split the user's text into the distinct image prompts
it contains. Return ONLY a JSON array of strings. Do not rewrite the prompts.")
and `model = <persisted split model>`. Parse: locate the first `[`…`]`, `JSON.parse`,
validate it's a string array. On any failure throw `SplitError("AI split didn't
work — try editing your prompts manually.")`.

**Detection rule (consumers):** run `splitPromptsHeuristic`. If `length > 1`,
offer split with the list pre-filled. If `=== 1`, show an "AI split" affordance
that calls `splitPromptsLLM`.

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

export const DEFAULT_SPLIT_MODEL = "google/gemini-3.1-flash";  // NEW
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

1. User types/pastes input in `PromptForm`. On change, run
   `splitPromptsHeuristic`.
2. If `>1` block → a **"Split into N prompts"** affordance appears. If `===1`
   block → an **"AI split"** button appears.
3. Either path opens **`SplitReview`**: an editable list of the parsed prompts
   (edit / remove / add row). It shows **"This will generate N images (N
   requests)"**, highlighted (red) when **N ≥ 12**.
4. Confirm → `useGeneration` calls `generateBatch` (throttled, client-side, BYOK)
   → gallery renders one card per prompt, each captioned with its prompt;
   partial results stream in as they resolve.
5. Browser POSTs `{ kind: "batch", model, images:[{...,prompt}] }` to
   `/api/sessions`; the route calls `saveSession`. UI shows the saved folder path.

### CLI

In `generateFlow`, after capturing the prompt text: run
`splitPromptsHeuristic`. If `>1` → `note` the numbered list, then `confirm`
"Generate these N as separate images? (N requests)". If `===1` → offer an "AI
split" option in the model/flow menu that calls `splitPromptsLLM` and re-shows
the list. On confirm → `generateBatch` → `saveSession({ kind: "batch", … })`.

## Settings: persisted split model

- Constant default `DEFAULT_SPLIT_MODEL = "google/gemini-3.1-flash"`.
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
- `splitPromptsLLM` failure → `SplitError`; UI/CLI surfaces a clear message and
  leaves the user on the manual review list.
- Throttling reduces 429s; an individual 429 is still surfaced per-prompt
  (existing `errorForStatus`).
- Large-batch cost: the total-request count is always shown pre-generation and
  highlighted at N ≥ 12; the confirm gate is the user's stop point.

## Testing (Vitest, TDD)

- **`split.test.ts`** — numbered lists, bullets, blank-line blocks, plain
  newlines, marker stripping, single-block → `[input]`; `splitPromptsLLM` JSON
  parse + defensive `SplitError` on bad output (mocked `fetch`).
- **`generate.test.ts`** — `generateBatch`: one request per prompt, distinct
  sequential seeds, per-image `prompt` attached, throttle respects max in-flight
  (assert peak concurrency ≤ N), partial success on one failure.
- **`storage.test.ts`** — batch save writes per-image `prompt` and `kind:"batch"`
  into `metadata.json`; batch-label folder naming.
- **`config.test.ts`** — `splitModel` round-trips; falls back to
  `DEFAULT_SPLIT_MODEL` when unset.
- Web components (`SplitReview`) tested lightly: count display + warning
  threshold, add/edit/remove rows.

## Defaults

- Split model: **`google/gemini-3.1-flash`** (persisted, editable).
- Concurrency: **6** in-flight (clamp 5–10).
- Large-batch warning threshold: **N ≥ 12**.
- Batch size: **no hard cap** (count display + warning is the guard).
- One image per split prompt; variations control hidden in split mode.
