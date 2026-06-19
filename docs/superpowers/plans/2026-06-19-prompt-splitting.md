# Prompt Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in prompt-splitting layer that decomposes one structured multi-prompt input into N parallel single-image generations (a "batch"), reviewed/confirmed by the user before generating.

**Architecture:** Additive to the existing single Next.js app. A new isomorphic `src/core/split.ts` (heuristic + LLM fallback), a throttled `generateBatch` in `src/core/generate.ts`, small `types.ts`/`storage.ts` extensions, and web/CLI integration. The browser-safe-barrel invariant holds — `split.ts` uses no `fs` and is exported from `src/core/index.ts`.

**Tech Stack:** TypeScript 5, Next.js 15 (App Router) + React 19, lucide-react, @clack/prompts (CLI), vitest. Raw `fetch` to OpenRouter — no SDK.

## Global Constraints

- **Split only** — never rewrite/enhance the user's prompts. Splitting is opt-in; the user reviews/edits the parsed list before anything generates.
- **1 image per split prompt.** Variations and splitting never combine in one action.
- Each split prompt = one `generateImage` call with a **distinct seed** (`baseSeed + i`).
- **Throttle concurrency** for batches: default **6** in-flight, clamped to **[5, 10]**. No hard cap on batch size — the total-request count shown at confirm time (highlighted at **N ≥ 12**) is the guard.
- Batch persistence: **one flat folder** (`NN.png` + `metadata.json`), each `images[]` entry records its own `prompt`; `kind: "batch"`.
- Split model default **`google/gemini-3.1-flash`** (`DEFAULT_SPLIT_MODEL`), persisted and user-editable (web `localStorage`, CLI config file). Distinct from the image model.
- `src/core/split.ts` MUST be isomorphic (no `node:fs`) so the browser-safe barrel can export it.
- **Ordering dependency:** Tasks 1–3 build on the already-implemented `src/core/` and are buildable immediately. Tasks 4–7 require the base plan ([2026-06-19-openrouter-image-gen.md](./2026-06-19-openrouter-image-gen.md)) Tasks 6–9 (the `/api/sessions` route, `useApiKey`/`useGeneration` hooks, components, and CLI) to be complete; they reference those interfaces verbatim.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/core/types.ts` (modify) | `GeneratedImage.prompt?`, `Session.kind`, `images[].prompt?`, `DEFAULT_SPLIT_MODEL` |
| `src/core/split.ts` (create) | `splitPromptsHeuristic`, `splitPromptsLLM`, `batchLabel`, `SplitError` |
| `src/core/generate.ts` (modify) | `generateBatch` + internal `runThrottled` pool |
| `src/core/storage.ts` (modify) | persist `kind` + per-image `prompt` |
| `src/core/index.ts` (modify) | export `./split` |
| `src/app/api/sessions/route.ts` (modify) | accept `kind` + per-image `prompt` |
| `src/app/lib/useSettings.ts` (create) | persist split model in `localStorage` |
| `src/app/lib/useSplit.ts` (create) | heuristic + LLM split for the web |
| `src/app/components/SplitReview.tsx` (create) | editable parsed-prompt list + count/warning |
| `src/app/lib/useGeneration.ts` (modify) | `runBatch` for batch generation + save |
| `src/app/page.tsx` (modify) | wire split affordance + review panel |
| `cli/config.ts` (modify) | `loadSplitModel` / `saveSplitModel` |
| `cli/index.ts` (modify) | split detection + review/confirm in `generateFlow` |

---

## Task 1: Core — `split.ts` (heuristic + LLM fallback + batch label)

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/split.ts`
- Modify: `src/core/index.ts`
- Test: `src/core/split.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `DEFAULT_SPLIT_MODEL: string` (in `types.ts`).
  - `splitPromptsHeuristic(input: string): string[]`.
  - `splitPromptsLLM(input: string, params: { apiKey: string; model?: string; signal?: AbortSignal }, fetchImpl?: typeof fetch): Promise<string[]>`.
  - `batchLabel(prompts: string[]): string`.
  - `class SplitError extends Error`.

- [ ] **Step 1: Add `DEFAULT_SPLIT_MODEL` to `src/core/types.ts`**

Append to the end of `src/core/types.ts`:
```ts
export const DEFAULT_SPLIT_MODEL = "google/gemini-3.1-flash";
```

- [ ] **Step 2: Write the failing test `src/core/split.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import {
  splitPromptsHeuristic,
  splitPromptsLLM,
  batchLabel,
  SplitError,
} from "./split";

describe("splitPromptsHeuristic", () => {
  it("splits numbered lists and strips the markers", () => {
    expect(splitPromptsHeuristic("1. a cat\n2. a dog\n3. a bird")).toEqual([
      "a cat",
      "a dog",
      "a bird",
    ]);
  });

  it("splits 1) and 1 - numbering too", () => {
    expect(splitPromptsHeuristic("1) red car\n2) blue car")).toEqual(["red car", "blue car"]);
  });

  it("splits bullet lists", () => {
    expect(splitPromptsHeuristic("- a cat\n- a dog")).toEqual(["a cat", "a dog"]);
  });

  it("splits blank-line-separated blocks", () => {
    expect(splitPromptsHeuristic("a cat in space\n\na dog on the moon")).toEqual([
      "a cat in space",
      "a dog on the moon",
    ]);
  });

  it("splits plain newline-separated lines", () => {
    expect(splitPromptsHeuristic("a cat\na dog")).toEqual(["a cat", "a dog"]);
  });

  it("returns a single-element array for one prompt", () => {
    expect(splitPromptsHeuristic("just one prompt please")).toEqual(["just one prompt please"]);
  });

  it("returns [] for empty input", () => {
    expect(splitPromptsHeuristic("   ")).toEqual([]);
  });
});

describe("batchLabel", () => {
  it("labels a multi-prompt batch with '+N more'", () => {
    expect(batchLabel(["a cat in space", "a dog", "a bird"])).toBe("a cat in space +2 more");
  });
  it("returns the single prompt unchanged when there is one", () => {
    expect(batchLabel(["a cat"])).toBe("a cat");
  });
});

describe("splitPromptsLLM", () => {
  const arrayResponse = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it("parses a JSON array from the model response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('["a cat", "a dog"]'));
    const prompts = await splitPromptsLLM(
      "a cat and a dog",
      { apiKey: "k" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(prompts).toEqual(["a cat", "a dog"]);
  });

  it("extracts the array even with surrounding prose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('Sure!\n["x", "y"]\nDone.'));
    const prompts = await splitPromptsLLM("x y", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(prompts).toEqual(["x", "y"]);
  });

  it("uses DEFAULT_SPLIT_MODEL when no model is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse('["a"]'));
    await splitPromptsLLM("a", { apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("google/gemini-3.1-flash");
  });

  it("throws SplitError on unparseable output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arrayResponse("no json here"));
    await expect(
      splitPromptsLLM("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(SplitError);
  });

  it("throws SplitError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(
      splitPromptsLLM("x", { apiKey: "k" }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(SplitError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/split.test.ts`
Expected: FAIL — cannot import from `./split`.

- [ ] **Step 4: Write `src/core/split.ts`**

```ts
import { DEFAULT_SPLIT_MODEL } from "./types";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

/**
 * Pure, no network. Detect the distinct prompts in structured input.
 * First matching strategy wins; returns [input] when it looks like one prompt,
 * [] when empty.
 */
export function splitPromptsHeuristic(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);

  // 1. Numbered items: "1." / "1)" / "1 -" / "1:"
  const numbered = lines
    .map((l) => l.match(/^\s*\d+\s*[.)\-:]\s+(.*\S)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
  if (numbered.length > 1) return numbered;

  // 2. Bullets: "-" / "*" / "•"
  const bullets = lines
    .map((l) => l.match(/^\s*[-*•]\s+(.*\S)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
  if (bullets.length > 1) return bullets;

  // 3. Blank-line-separated blocks
  const blocks = text
    .split(/\n\s*\n+/)
    .map((b) => b.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (blocks.length > 1) return blocks;

  // 4. Plain non-empty lines
  const plain = lines.map((l) => l.trim()).filter(Boolean);
  if (plain.length > 1) return plain;

  return [text];
}

/** Human-readable label for a batch: first prompt (truncated) + "+N more". */
export function batchLabel(prompts: string[]): string {
  const first = prompts[0] ?? "batch";
  const head = first.length > 40 ? `${first.slice(0, 40).trimEnd()}…` : first;
  return prompts.length > 1 ? `${head} +${prompts.length - 1} more` : head;
}

function parseJsonArray(content: string | undefined): string[] | null {
  if (!content) return null;
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const arr: unknown = JSON.parse(content.slice(start, end + 1));
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return (arr as string[]).map((s) => s.trim()).filter(Boolean);
    }
    return null;
  } catch {
    return null;
  }
}

/** Network fallback: ask a cheap text model for a JSON array of prompts. */
export async function splitPromptsLLM(
  input: string,
  params: { apiKey: string; model?: string; signal?: AbortSignal },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const model = params.model ?? DEFAULT_SPLIT_MODEL;
  let res: Response;
  try {
    res = await fetchImpl(COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Split the user's text into the distinct image prompts it contains. " +
              "Return ONLY a JSON array of strings, one per prompt. " +
              "Do not rewrite, summarize, merge, or add prompts.",
          },
          { role: "user", content: input },
        ],
      }),
      signal: params.signal,
    });
  } catch (e) {
    throw new SplitError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw new SplitError(`AI split request failed (${res.status})`);
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  const prompts = parseJsonArray(content);
  if (!prompts || prompts.length === 0) {
    throw new SplitError("AI split didn't work — try editing your prompts manually.");
  }
  return prompts;
}
```

- [ ] **Step 5: Export from the browser-safe barrel `src/core/index.ts`**

Add after the `./slug` export line:
```ts
export * from "./split";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/core/split.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/split.ts src/core/index.ts src/core/split.test.ts
git commit -m "feat(core): prompt splitting (heuristic + LLM fallback) and batch label"
```

---

## Task 2: Core — `generateBatch` (throttled, one image per prompt)

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/generate.ts`
- Test: `src/core/generate.test.ts` (append)

**Interfaces:**
- Consumes: `generateImage`, `GenerateParams`, `GeneratedImage` (existing).
- Produces:
  - `GeneratedImage.prompt?: string` (new optional field).
  - `generateBatch(prompts: string[], params: Omit<GenerateParams, "prompt" | "seed" | "index">, opts?: { fetchImpl?: typeof fetch; baseSeed?: number; concurrency?: number }): Promise<GeneratedImage[]>`.

- [ ] **Step 1: Add `prompt?` to `GeneratedImage` in `src/core/types.ts`**

Change the `GeneratedImage` interface to:
```ts
export interface GeneratedImage {
  index: number;
  dataUrl: string;   // "" when error is set
  seed?: number;
  prompt?: string;   // the prompt that produced this image (batch mode)
  error?: string;
}
```

- [ ] **Step 2: Append the failing tests to `src/core/generate.test.ts`**

Add inside the file (after the existing `generateVariations` describe block):
```ts
import { generateBatch } from "./generate";

describe("generateBatch", () => {
  const imageResponse = (url: string) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "ok", images: [{ image_url: { url } }] } }],
    }),
  });

  it("fires one request per prompt with distinct seeds and attaches each prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("data:image/png;base64,AAA"));
    const imgs = await generateBatch(
      ["a cat", "a dog", "a bird"],
      { apiKey: "k", model: "m" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 100 },
    );
    expect(imgs).toHaveLength(3);
    expect(imgs.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(imgs.map((i) => i.seed)).toEqual([100, 101, 102]);
    expect(imgs.map((i) => i.prompt)).toEqual(["a cat", "a dog", "a bird"]);
  });

  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return imageResponse("data:image/png;base64,AAA");
    });
    await generateBatch(
      Array.from({ length: 12 }, (_, i) => `p${i}`),
      { apiKey: "k", model: "m" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 0, concurrency: 5 },
    );
    expect(peak).toBeLessThanOrEqual(5);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });

  it("allows partial success and tags the failed prompt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse("data:image/png;base64,AAA"))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const imgs = await generateBatch(
      ["good prompt", "bad prompt"],
      { apiKey: "k", model: "m" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseSeed: 0, concurrency: 5 },
    );
    expect(imgs.filter((i) => i.dataUrl)).toHaveLength(1);
    const failed = imgs.find((i) => i.error);
    expect(failed?.prompt).toBe("bad prompt");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/generate.test.ts`
Expected: FAIL — `generateBatch` is not exported.

- [ ] **Step 4: Add `runThrottled` + `generateBatch` to `src/core/generate.ts`**

Append to `src/core/generate.ts`:
```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/generate.test.ts`
Expected: PASS (existing + new `generateBatch` cases).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/generate.ts src/core/generate.test.ts
git commit -m "feat(core): throttled generateBatch with per-prompt seeds"
```

---

## Task 3: Core — storage persists batch kind + per-image prompt

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/storage.ts`
- Test: `src/core/storage.test.ts` (append)

**Interfaces:**
- Consumes: `saveSession` (existing), `GeneratedImage.prompt?` (Task 2).
- Produces:
  - `Session.kind: "variations" | "batch"`; `Session.images[].prompt?: string`.
  - `saveSession` input gains optional `kind?: "variations" | "batch"`; per-image `prompt` is written when present. Default `kind` is `"variations"` (existing callers unchanged).

- [ ] **Step 1: Update `Session` in `src/core/types.ts`**

Change the `Session` interface to:
```ts
export interface Session {
  sessionId: string;
  prompt: string;            // batch label when kind === "batch"
  model: string;
  count: number;
  createdAt: string;         // ISO
  kind: "variations" | "batch";
  images: { file: string; seed?: number; prompt?: string }[];
}
```

- [ ] **Step 2: Append the failing test to `src/core/storage.test.ts`**

```ts
describe("saveSession (batch)", () => {
  it("records kind=batch and each image's prompt", async () => {
    const b64 = Buffer.from("img").toString("base64");
    const { dir, session } = await saveSession({
      prompt: "a cat +1 more",
      model: "m",
      kind: "batch",
      images: [
        { index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1, prompt: "a cat" },
        { index: 1, dataUrl: `data:image/png;base64,${b64}`, seed: 2, prompt: "a dog" },
      ],
      rootDir: root,
    });
    expect(session.kind).toBe("batch");
    expect(session.images).toEqual([
      { file: "01.png", seed: 1, prompt: "a cat" },
      { file: "02.png", seed: 2, prompt: "a dog" },
    ]);
    const meta = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
    expect(meta.kind).toBe("batch");
    expect(meta.images[1].prompt).toBe("a dog");
  });

  it("defaults kind to variations and omits prompt when absent", async () => {
    const b64 = Buffer.from("img").toString("base64");
    const { session } = await saveSession({
      prompt: "a cat",
      model: "m",
      images: [{ index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1 }],
      rootDir: root,
    });
    expect(session.kind).toBe("variations");
    expect(session.images[0]).toEqual({ file: "01.png", seed: 1 });
  });
});
```

(`root`, `fs`, `path`, and `saveSession` are already imported/set up at the top of the existing test file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/storage.test.ts`
Expected: FAIL — `kind` is missing from the result / not accepted in input.

- [ ] **Step 4: Update `src/core/storage.ts`**

Change the `saveSession` signature and body. The input type gains `kind?`; the per-image push includes `prompt` when present; the `Session` includes `kind`:
```ts
export async function saveSession(input: {
  prompt: string;
  model: string;
  images: GeneratedImage[];
  kind?: "variations" | "batch";
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
    // All dataUrls produced by generate.ts are base64-encoded PNG data URLs.
    const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    await fs.writeFile(path.join(dir, file), Buffer.from(base64, "base64"));
    images.push({ file, seed: img.seed, ...(img.prompt ? { prompt: img.prompt } : {}) });
    n++;
  }

  const session: Session = {
    sessionId: id,
    prompt: input.prompt,
    model: input.model,
    count: images.length,
    createdAt: now.toISOString(),
    kind: input.kind ?? "variations",
    images,
  };
  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(session, null, 2));
  return { dir, session };
}
```

- [ ] **Step 5: Run full core suite + typecheck**

Run: `npm test`
Expected: PASS (slug, models, generate incl. batch, storage incl. batch, split).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/storage.ts src/core/storage.test.ts
git commit -m "feat(core): persist batch kind and per-image prompt in sessions"
```

---

> **Tasks 4–7 require the base plan ([2026-06-19-openrouter-image-gen.md](./2026-06-19-openrouter-image-gen.md)) Tasks 6–9 to be complete.** They modify the `/api/sessions` route, the web hooks/components/page, and the CLI created there.

## Task 4: Web — `/api/sessions` accepts batch kind + per-image prompt

**Files:**
- Modify: `src/app/api/sessions/route.ts`
- Test: `src/app/api/sessions/route.test.ts` (append)

**Interfaces:**
- Consumes: `saveSession` (now accepts `kind`, per-image `prompt`).
- Produces: `POST` body additionally accepts `kind?: "variations" | "batch"`; forwards `kind` and the (prompt-bearing) `images` to `saveSession`.

- [ ] **Step 1: Append the failing test to `src/app/api/sessions/route.test.ts`**

```ts
it("saves a batch with per-image prompts", async () => {
  const { POST } = await import("./route");
  const b64 = Buffer.from("img").toString("base64");
  const req = new Request("http://localhost/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      prompt: "a cat +1 more",
      model: "m",
      kind: "batch",
      images: [
        { index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1, prompt: "a cat" },
        { index: 1, dataUrl: `data:image/png;base64,${b64}`, seed: 2, prompt: "a dog" },
      ],
    }),
  });
  const res = await POST(req as any);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.session.kind).toBe("batch");
  expect(json.session.images[1].prompt).toBe("a dog");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/sessions/route.test.ts`
Expected: FAIL — `session.kind` is `"variations"` (route drops `kind`).

- [ ] **Step 3: Update `src/app/api/sessions/route.ts`**

Add `kind` to the `SaveBody` interface and forward it:
```ts
interface SaveBody {
  prompt?: string;
  model?: string;
  kind?: "variations" | "batch";
  images?: GeneratedImage[];
}

export async function POST(req: Request) {
  try {
    const { prompt, model, kind, images } = (await req.json()) as SaveBody;
    if (!prompt || !model || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "prompt, model and images are required" },
        { status: 400 },
      );
    }
    const { dir, session } = await saveSession({ prompt, model, kind, images });
    return NextResponse.json({ dir, session });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/sessions/route.test.ts`
Expected: PASS (existing + batch case).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sessions/route.ts src/app/api/sessions/route.test.ts
git commit -m "feat(web): /api/sessions accepts batch kind and per-image prompts"
```

---

## Task 5: Web — persisted split-model setting

**Files:**
- Create: `src/app/lib/useSettings.ts`
- Test: `src/app/lib/useSettings.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SPLIT_MODEL` from `@/core`.
- Produces: `useSettings(): { splitModel: string; setSplitModel: (m: string) => void }` — `localStorage`-backed (key `openrouter_split_model`), defaulting to `DEFAULT_SPLIT_MODEL`.

- [ ] **Step 1: Write the failing test `src/app/lib/useSettings.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettings } from "./useSettings";
import { DEFAULT_SPLIT_MODEL } from "@/core";

beforeEach(() => localStorage.clear());

describe("useSettings", () => {
  it("defaults the split model to DEFAULT_SPLIT_MODEL", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.splitModel).toBe(DEFAULT_SPLIT_MODEL);
  });

  it("persists a custom split model", () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.setSplitModel("openai/gpt-5-mini"));
    expect(result.current.splitModel).toBe("openai/gpt-5-mini");
    expect(localStorage.getItem("openrouter_split_model")).toBe("openai/gpt-5-mini");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/lib/useSettings.test.ts`
Expected: FAIL — cannot import `./useSettings`.

- [ ] **Step 3: Write `src/app/lib/useSettings.ts`**

```ts
"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SPLIT_MODEL } from "@/core";

const SPLIT_MODEL_KEY = "openrouter_split_model";

export function useSettings() {
  const [splitModel, setModel] = useState(DEFAULT_SPLIT_MODEL);

  useEffect(() => {
    const stored = localStorage.getItem(SPLIT_MODEL_KEY);
    if (stored) setModel(stored);
  }, []);

  const setSplitModel = (m: string) => {
    const value = m.trim() || DEFAULT_SPLIT_MODEL;
    localStorage.setItem(SPLIT_MODEL_KEY, value);
    setModel(value);
  };

  return { splitModel, setSplitModel };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/lib/useSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/useSettings.ts src/app/lib/useSettings.test.ts
git commit -m "feat(web): persisted split-model setting hook"
```

---

## Task 6: Web — split detection, review panel, and batch generation

**Files:**
- Create: `src/app/lib/useSplit.ts`
- Create: `src/app/components/SplitReview.tsx`
- Modify: `src/app/lib/useGeneration.ts`
- Modify: `src/app/page.tsx`
- Test: `src/app/components/SplitReview.test.tsx`

**Interfaces:**
- Consumes: `splitPromptsHeuristic`, `splitPromptsLLM`, `batchLabel`, `generateBatch`, `GeneratedImage` from `@/core`; `useSettings` (Task 5); `useApiKey` (base Task 7).
- Produces:
  - `useSplit(): { detect: (input: string) => string[]; aiSplit: (input: string, apiKey: string, model: string) => Promise<string[]> }`.
  - `useGeneration().runBatch(args: { apiKey: string; model: string; prompts: string[] }): Promise<void>` (added alongside the existing `run`).
  - `SplitReview` component (props below).

- [ ] **Step 1: Write `src/app/lib/useSplit.ts`**

```ts
"use client";
import { splitPromptsHeuristic, splitPromptsLLM } from "@/core";

export function useSplit() {
  const detect = (input: string) => splitPromptsHeuristic(input);
  const aiSplit = (input: string, apiKey: string, model: string) =>
    splitPromptsLLM(input, { apiKey, model });
  return { detect, aiSplit };
}
```

- [ ] **Step 2: Add `runBatch` to `src/app/lib/useGeneration.ts`**

First extend the import line at the top of the file (the base hook imports only `generateVariations`) to also pull in `generateBatch` and `batchLabel`:
```ts
import { generateVariations, generateBatch, batchLabel, type GeneratedImage } from "@/core";
```

Then, inside the `useGeneration` hook, after the existing `run` function, add `runBatch` and include it in the returned object. It mirrors `run` but calls `generateBatch(prompts, params)` and saves with `kind: "batch"` and a batch label:
```ts
async function runBatch(args: { apiKey: string; model: string; prompts: string[] }) {
  setLoading(true);
  setError(null);
  setSavedDir(null);
  setImages([]);
  try {
    const results = await generateBatch(args.prompts, {
      apiKey: args.apiKey,
      model: args.model,
    });
    setImages(results);

    const successful = results.filter((r) => r.dataUrl && !r.error);
    if (successful.length > 0) {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: batchLabel(args.prompts),
          model: args.model,
          kind: "batch",
          images: successful,
        }),
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

return { images, loading, savedDir, error, run, runBatch };
```

- [ ] **Step 3: Write the failing test `src/app/components/SplitReview.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SplitReview } from "./SplitReview";

describe("SplitReview", () => {
  it("shows the request count and highlights large batches", () => {
    const prompts = Array.from({ length: 12 }, (_, i) => `prompt ${i}`);
    render(<SplitReview prompts={prompts} onChange={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    const count = screen.getByTestId("request-count");
    expect(count.textContent).toContain("12");
    expect(count.className).toContain("text-red");
  });

  it("does not highlight small batches", () => {
    render(<SplitReview prompts={["a", "b"]} onChange={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("request-count").className).not.toContain("text-red");
  });

  it("removes a row", () => {
    const onChange = vi.fn();
    render(<SplitReview prompts={["a", "b"]} onChange={onChange} onConfirm={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getAllByLabelText("Remove prompt")[0]);
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("confirms with the current prompts", () => {
    const onConfirm = vi.fn();
    render(<SplitReview prompts={["a", "b"]} onChange={() => {}} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText(/Generate 2/));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/app/components/SplitReview.test.tsx`
Expected: FAIL — cannot import `./SplitReview`.

- [ ] **Step 5: Write `src/app/components/SplitReview.tsx`**

```tsx
"use client";
import { Trash2, Plus, Sparkles, X } from "lucide-react";

const WARN_THRESHOLD = 12;

export function SplitReview({
  prompts, onChange, onConfirm, onCancel,
}: {
  prompts: string[];
  onChange: (next: string[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const setAt = (i: number, value: string) =>
    onChange(prompts.map((p, idx) => (idx === i ? value : p)));
  const removeAt = (i: number) => onChange(prompts.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...prompts, ""]);

  const n = prompts.filter((p) => p.trim()).length;
  const large = n >= WARN_THRESHOLD;

  return (
    <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Review prompts to generate</h2>
        <button onClick={onCancel} aria-label="Cancel split"><X className="h-4 w-4" /></button>
      </div>

      <ul className="space-y-2">
        {prompts.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-neutral-500">{i + 1}.</span>
            <input
              value={p}
              onChange={(e) => setAt(i, e.target.value)}
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
            <button onClick={() => removeAt(i)} aria-label="Remove prompt">
              <Trash2 className="h-4 w-4 text-neutral-500 hover:text-neutral-300" />
            </button>
          </li>
        ))}
      </ul>

      <button
        onClick={addRow}
        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
      >
        <Plus className="h-3.5 w-3.5" /> Add prompt
      </button>

      <div className="flex items-center justify-between pt-2">
        <span
          data-testid="request-count"
          className={`text-xs ${large ? "font-medium text-red-400" : "text-neutral-500"}`}
        >
          This will generate {n} image{n === 1 ? "" : "s"} ({n} request{n === 1 ? "" : "s"})
          {large ? " — that's a lot" : ""}
        </span>
        <button
          onClick={onConfirm}
          disabled={n === 0}
          className="flex items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" /> Generate {n}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/app/components/SplitReview.test.tsx`
Expected: PASS.

- [ ] **Step 7: Wire split into `src/app/page.tsx`**

Add the split flow alongside the existing single-prompt flow. Add imports and state, a "Split into N prompts" affordance when `detect(prompt).length > 1`, an "AI split" button otherwise, and render `SplitReview` when a candidate list exists:
```tsx
import { useSplit } from "./lib/useSplit";
import { useSettings } from "./lib/useSettings";
import { SplitReview } from "./components/SplitReview";
import { Scissors } from "lucide-react";
// ...

// inside Home():
const { detect, aiSplit } = useSplit();
const { splitModel } = useSettings();
const { images, loading, savedDir, error, run, runBatch } = useGeneration();
const [splitList, setSplitList] = useState<string[] | null>(null);
const [splitting, setSplitting] = useState(false);

const detected = detect(prompt);
const canHeuristicSplit = detected.length > 1;

const openSplit = () => setSplitList(detected);
const onAiSplit = async () => {
  if (!apiKey) return setShowKey(true);
  setSplitting(true);
  try {
    setSplitList(await aiSplit(prompt, apiKey, splitModel));
  } catch (e) {
    // SplitError or network — surface via the existing error channel is fine;
    // here we just keep the user on the manual editor with the raw prompt.
    setSplitList([prompt]);
  } finally {
    setSplitting(false);
  }
};
const confirmSplit = () => {
  if (!apiKey) return setShowKey(true);
  const prompts = (splitList ?? []).map((p) => p.trim()).filter(Boolean);
  if (prompts.length === 0) return;
  setSplitList(null);
  runBatch({ apiKey, model, prompts });
};
```

Render, just below `<PromptForm .../>`:
```tsx
{prompt.trim() && (
  <div className="mt-3 flex gap-2">
    {canHeuristicSplit ? (
      <button
        onClick={openSplit}
        className="flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
      >
        <Scissors className="h-3.5 w-3.5" /> Split into {detected.length} prompts
      </button>
    ) : (
      <button
        onClick={onAiSplit}
        disabled={splitting}
        className="flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-40"
      >
        <Scissors className="h-3.5 w-3.5" /> {splitting ? "Splitting…" : "AI split"}
      </button>
    )}
  </div>
)}

{splitList && (
  <div className="mt-4">
    <SplitReview
      prompts={splitList}
      onChange={setSplitList}
      onConfirm={confirmSplit}
      onCancel={() => setSplitList(null)}
    />
  </div>
)}
```

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Manual verification**

Run: `npm run dev`. Paste `1. a cat in space\n2. a dog on the moon\n3. a bird in a tree`. Verify: "Split into 3 prompts" appears → click → review panel lists 3 editable rows, "This will generate 3 images (3 requests)" (not red) → Generate → 3 cards render; a single `generations/<batch>/` folder with `01.png 02.png 03.png` + `metadata.json` (`kind:"batch"`, per-image prompts). Then paste a single messy sentence → "AI split" appears → click → review panel populates. Paste 12+ numbered prompts → count shows red.

- [ ] **Step 10: Commit**

```bash
git add src/app/lib/useSplit.ts src/app/lib/useGeneration.ts src/app/components/SplitReview.tsx src/app/components/SplitReview.test.tsx src/app/page.tsx
git commit -m "feat(web): prompt-split detection, review panel, batch generation"
```

---

## Task 7: CLI — split model config + split detection in the flow

**Files:**
- Modify: `cli/config.ts`
- Modify: `cli/index.ts`
- Test: `cli/config.test.ts` (append)

**Interfaces:**
- Consumes: `splitPromptsHeuristic`, `splitPromptsLLM`, `batchLabel`, `generateBatch`, `DEFAULT_SPLIT_MODEL` (core); `loadKey`, `generateFlow` (base Task 9); `saveSession`.
- Produces:
  - `loadSplitModel(): string` (config `splitModel` field, else `DEFAULT_SPLIT_MODEL`).
  - `saveSplitModel(model: string): void`.

- [ ] **Step 1: Append the failing test to `cli/config.test.ts`**

```ts
describe("cli split model config", () => {
  it("defaults to DEFAULT_SPLIT_MODEL when unset", async () => {
    const { loadSplitModel } = await import("./config");
    const { DEFAULT_SPLIT_MODEL } = await import("../src/core/types");
    expect(loadSplitModel()).toBe(DEFAULT_SPLIT_MODEL);
  });

  it("round-trips a saved split model alongside the key", async () => {
    const { saveKey, saveSplitModel, loadSplitModel, loadKey } = await import("./config");
    saveKey("file-key");
    saveSplitModel("openai/gpt-5-mini");
    expect(loadSplitModel()).toBe("openai/gpt-5-mini");
    expect(loadKey()).toBe("file-key"); // saving the model must not clobber the key
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/config.test.ts`
Expected: FAIL — `loadSplitModel`/`saveSplitModel` not exported.

- [ ] **Step 3: Update `cli/config.ts`**

Refactor read/write to share a config object so the key and split model coexist, and add the split-model accessors:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SPLIT_MODEL } from "../src/core/types.js";

interface CliConfig {
  apiKey?: string;
  splitModel?: string;
}

export function configPath(): string {
  return path.join(os.homedir(), ".openrouter-image-gen.json");
}

function readConfig(): CliConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

function writeConfig(next: CliConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
}

export function loadKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  return readConfig().apiKey ?? null;
}

export function saveKey(key: string): void {
  writeConfig({ ...readConfig(), apiKey: key });
}

export function loadSplitModel(): string {
  return readConfig().splitModel ?? DEFAULT_SPLIT_MODEL;
}

export function saveSplitModel(model: string): void {
  writeConfig({ ...readConfig(), splitModel: model });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/config.test.ts`
Expected: PASS (existing key tests + new split-model tests; the key round-trip still works because `saveKey`/`saveSplitModel` merge).

- [ ] **Step 5: Add split detection to `generateFlow` in `cli/index.ts`**

After the prompt is captured (and before the model select), detect and optionally split. Add imports and a confirm step:
```ts
import { splitPromptsHeuristic, splitPromptsLLM, batchLabel } from "../src/core/split.js";
import { generateBatch } from "../src/core/generate.js";
import { loadSplitModel } from "./config.js";
```

Insert after `prompt` is finalized in `generateFlow`, before model selection:
```ts
const parts = splitPromptsHeuristic(prompt);
let prompts: string[] | null = null;

if (parts.length > 1) {
  note(parts.map((p, i) => `${i + 1}. ${p}`).join("\n"), "Detected prompts");
  const doSplit = await confirm({
    message: `Generate these ${parts.length} as separate images? (${parts.length} requests)`,
  });
  bail(doSplit);
  if (doSplit) prompts = parts;
} else {
  const tryAi = await confirm({ message: "Try AI split into multiple prompts?" });
  bail(tryAi);
  if (tryAi) {
    try {
      const ai = await splitPromptsLLM(prompt, { apiKey, model: loadSplitModel() });
      note(ai.map((p, i) => `${i + 1}. ${p}`).join("\n"), "AI-split prompts");
      const ok = await confirm({ message: `Generate these ${ai.length} as separate images? (${ai.length} requests)` });
      bail(ok);
      if (ok) prompts = ai;
    } catch (e) {
      note((e as Error).message, "AI split failed");
    }
  }
}
```

Then, after the model id (`modelId`) is resolved, branch the generation/save on `prompts`:
```ts
if (prompts) {
  const s2 = spinner();
  s2.start(`Generating ${prompts.length} image(s)…`);
  const images = await generateBatch(prompts, { apiKey, model: modelId });
  const ok = images.filter((i) => i.dataUrl && !i.error);
  s2.stop(`Generated ${ok.length}/${prompts.length}.`);
  const failed = images.filter((i) => i.error);
  if (failed.length) note(failed.map((f) => `#${f.index + 1}: ${f.error}`).join("\n"), "Errors");
  if (ok.length === 0) return;
  const { dir } = await saveSession({ prompt: batchLabel(prompts), model: modelId, kind: "batch", images });
  note(dir, "Saved");
  return;
}
// ...existing single-prompt variations path unchanged below...
```

(The variation-count prompt and the existing `generateVariations` + `saveSession` path run only when `prompts` is null.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Run: `npm run cli`. Choose Generate → type `1. a cat\n2. a dog`. Verify: "Detected prompts" lists both → confirm → model select → spinner → "Saved <path>"; the folder is a single batch with `01.png 02.png` + `metadata.json` (`kind:"batch"`, per-image prompts). Then try a single-sentence prompt → "Try AI split" → confirm → AI-split list shown. Ctrl-C cancels cleanly.

- [ ] **Step 8: Commit**

```bash
git add cli/config.ts cli/index.ts cli/config.test.ts
git commit -m "feat(cli): split detection, AI split, and batch generation"
```

---

## Self-Review

**Spec coverage:**
- Split only, no enhancement → `splitPromptsHeuristic`/`splitPromptsLLM` return prompt strings verbatim; system prompt says "do not rewrite". ✓ (Task 1)
- Opt-in + user reviews/edits before generating → `SplitReview` (web), `confirm` (CLI). ✓ (Tasks 6, 7)
- Heuristic first, LLM fallback for single block → detection rule in page/CLI: `detect.length > 1` else AI split. ✓ (Tasks 6, 7)
- 1 image per prompt → `generateBatch` one `generateImage` per prompt. ✓ (Task 2)
- Distinct seed per prompt → `baseSeed + i`. ✓ (Task 2)
- Throttle 5–10 (default 6), no hard cap → `runThrottled`, clamp `Math.max(5, Math.min(10, …))`. ✓ (Task 2)
- Total-count display + warning at N ≥ 12 → `SplitReview` `request-count`; CLI confirm shows `(N requests)`. ✓ (Tasks 6, 7)
- One flat batch folder, per-image prompt, `kind:"batch"` → `saveSession` extension. ✓ (Task 3)
- Batch label "first +N more" → `batchLabel`. ✓ (Task 1)
- Persisted, editable split model, default `google/gemini-3.1-flash` → `DEFAULT_SPLIT_MODEL`, `useSettings`, `loadSplitModel`/`saveSplitModel`. ✓ (Tasks 1, 5, 7)
- Browser-safe barrel exports `split.ts` (isomorphic) → Task 1 Step 5; no `fs` in `split.ts`. ✓
- Partial success → `Promise.allSettled` semantics preserved in `runThrottled`. ✓ (Task 2)
- TDD across core + route + settings + components + config → every task is failing-test-first. ✓

**Placeholder scan:** No "TBD/TODO-as-gap". Every code step shows the full content to write. ✓

**Type consistency:** `GeneratedImage` (index/dataUrl/seed/prompt?/error), `Session` (…/kind/images[{file,seed?,prompt?}]), `generateBatch(prompts, params, opts)`, `saveSession({prompt,model,kind?,images,…})`, `splitPromptsLLM(input, {apiKey,model?,signal?}, fetchImpl?)`, `batchLabel(prompts)`, `useGeneration().runBatch({apiKey,model,prompts})`, `useSettings().{splitModel,setSplitModel}`, `loadSplitModel()/saveSplitModel()` — names/signatures match across producing and consuming tasks. ✓
