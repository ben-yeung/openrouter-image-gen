# Model Selection UI Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold "Custom" into the model dropdown — selecting it reveals one text field with debounced format + existence validation — and remove the separate custom input/"Use" button.

**Architecture:** A native `<select>` gains a trailing `Custom…` sentinel option; choosing it flips `ModelSelect` into custom mode and reveals a single text input below, while any named-model choice switches back. All gating logic lives in pure, unit-tested core helpers (`isValidSlugFormat`, `evaluateSlug`) and a single-fetch `fetchModelCatalog` that returns both the image-filtered model list and the set of all model ids for existence checks.

**Tech Stack:** TypeScript, React 19 (Next.js client component), Vitest + `@testing-library/react` (jsdom), `@clack/prompts` (CLI).

## Global Constraints

- No new runtime dependencies; use what's already in `package.json`.
- `@/core` is the import surface for the web app; new symbols in `src/core/models.ts` are auto-exported via `export * from "./models"`.
- Existing tests in `src/core/models.test.ts` must stay green (do not change their assertions).
- Vitest global env is `node`; component tests that need a DOM must start with `// @vitest-environment jsdom`.
- Match existing Tailwind styling conventions (`border-neutral-700`, `bg-neutral-950`, `text-xs uppercase tracking-wide text-neutral-500`, etc.).
- OpenRouter slug shape (verbatim regex): `^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(:[a-zA-Z0-9._-]+)?$`
- Debounce window for custom-slug validation: `400ms`.
- Custom sentinel option value: `"__custom__"`.

---

### Task 1: `isValidSlugFormat` core helper

**Files:**
- Modify: `src/core/models.ts`
- Test: `src/core/models.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isValidSlugFormat(slug: string): boolean` — pure, no network. Caller trims before calling.

- [ ] **Step 1: Write the failing test**

Append to `src/core/models.test.ts`:

```ts
import { isValidSlugFormat } from "./models";

describe("isValidSlugFormat", () => {
  it("accepts well-formed slugs", () => {
    for (const s of [
      "a/b",
      "google/gemini-3.1-flash-image-preview",
      "black-forest-labs/flux-1.1-pro",
      "author/model.name",
      "a/b:free",
    ]) {
      expect(isValidSlugFormat(s)).toBe(true);
    }
  });

  it("rejects malformed slugs", () => {
    for (const s of [
      "",
      "noslash",
      "a/b/c",
      "/b",
      "a/",
      "a b/c",
      "a/b:",
      "a/b:c:d",
    ]) {
      expect(isValidSlugFormat(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/models.test.ts`
Expected: FAIL — `isValidSlugFormat is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/core/models.ts` (near the top, after the imports):

```ts
const SLUG_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(:[a-zA-Z0-9._-]+)?$/;

export function isValidSlugFormat(slug: string): boolean {
  return SLUG_RE.test(slug);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/core/models.test.ts`
Expected: PASS (all `isValidSlugFormat` cases, plus the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/models.ts src/core/models.test.ts
git commit -m "feat(core): add isValidSlugFormat slug validator"
```

---

### Task 2: `fetchModelCatalog` (single fetch → image list + all ids)

**Files:**
- Modify: `src/core/models.ts`
- Test: `src/core/models.test.ts`

**Interfaces:**
- Consumes: `mergeModels`, `TOP_MODELS` (existing).
- Produces:
  - `interface ModelCatalog { imageModels: ImageModel[]; allIds: Set<string> }`
  - `fetchModelCatalog(fetchImpl?: typeof fetch): Promise<ModelCatalog>`
  - `fetchImageModels(fetchImpl?: typeof fetch): Promise<ImageModel[]>` (retained; now delegates to `fetchModelCatalog`).

- [ ] **Step 1: Write the failing test**

Append to `src/core/models.test.ts`:

```ts
import { fetchModelCatalog } from "./models";

describe("fetchModelCatalog", () => {
  it("returns image-filtered models plus the set of all ids", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "x/text-only", name: "T", architecture: { output_modalities: ["text"] } },
          { id: "x/img", name: "Img", architecture: { output_modalities: ["image", "text"] } },
        ],
      }),
    });
    const { imageModels, allIds } = await fetchModelCatalog(fakeFetch as unknown as typeof fetch);
    expect(imageModels.some((m) => m.id === "x/img")).toBe(true);
    expect(imageModels.some((m) => m.id === "x/text-only")).toBe(false);
    // allIds includes every id, including non-image models
    expect(allIds.has("x/text-only")).toBe(true);
    expect(allIds.has("x/img")).toBe(true);
  });

  it("falls back to TOP_MODELS with an empty id set on failure", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("network"));
    const { imageModels, allIds } = await fetchModelCatalog(fakeFetch as unknown as typeof fetch);
    expect(imageModels).toEqual(TOP_MODELS);
    expect(allIds.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/models.test.ts`
Expected: FAIL — `fetchModelCatalog is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/models.ts`, replace the existing `fetchImageModels` function (lines ~25-40) with:

```ts
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
```

- [ ] **Step 4: Run the full suite to verify pass + no regressions**

Run: `npm run test`
Expected: PASS — new `fetchModelCatalog` tests and the pre-existing `fetchImageModels` / `mergeModels` tests all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/models.ts src/core/models.test.ts
git commit -m "feat(core): add fetchModelCatalog returning image models + all ids"
```

---

### Task 3: `evaluateSlug` decision function

**Files:**
- Modify: `src/core/models.ts`
- Test: `src/core/models.test.ts`

**Interfaces:**
- Consumes: `isValidSlugFormat` (Task 1).
- Produces:
  - `type SlugStatus = "idle" | "invalid" | "valid"`
  - `evaluateSlug(draft: string, allIds: Set<string>, hasCatalog: boolean): { status: SlugStatus; commit: boolean }` — pure; `draft` assumed already trimmed.

- [ ] **Step 1: Write the failing test**

Append to `src/core/models.test.ts`:

```ts
import { evaluateSlug } from "./models";

describe("evaluateSlug", () => {
  const ids = new Set(["author/known"]);

  it("is idle on empty input", () => {
    expect(evaluateSlug("", ids, true)).toEqual({ status: "idle", commit: false });
  });

  it("is invalid (no commit) on bad format", () => {
    expect(evaluateSlug("noslash", ids, true)).toEqual({ status: "invalid", commit: false });
  });

  it("commits when format is good and id exists in the loaded catalog", () => {
    expect(evaluateSlug("author/known", ids, true)).toEqual({ status: "valid", commit: true });
  });

  it("is invalid when format is good but id is missing from the loaded catalog", () => {
    expect(evaluateSlug("author/unknown", ids, true)).toEqual({ status: "invalid", commit: false });
  });

  it("commits any well-formed slug when the catalog is unavailable (offline)", () => {
    expect(evaluateSlug("author/unknown", new Set(), false)).toEqual({ status: "valid", commit: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/models.test.ts`
Expected: FAIL — `evaluateSlug is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/core/models.ts` (after `isValidSlugFormat`):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/core/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/models.ts src/core/models.test.ts
git commit -m "feat(core): add evaluateSlug validation decision helper"
```

---

### Task 4: Consolidated `ModelSelect` component

**Files:**
- Modify (full rewrite): `src/app/components/ModelSelect.tsx`
- Test: `src/app/components/ModelSelect.test.tsx`

**Interfaces:**
- Consumes: `fetchModelCatalog`, `evaluateSlug`, `TOP_MODELS`, `ImageModel` (from `@/core`).
- Produces: `ModelSelect({ value, onChange }: { value: string; onChange: (id: string) => void })` — unchanged public props, so `PromptForm` needs no edit.

Notes on behavior (source of truth is the code below):
- The 400ms debounce shows a transient `checking` UI state for the entire debounce window, then resolves via `evaluateSlug` to `valid`/`invalid` (and commits only when `valid`). `hasCatalog` is `allIds.size > 0`.
- The synthetic `★ {value} (custom)` option from the old component is gone; custom values display as the `Custom…` sentinel with the slug shown in the revealed field.

- [ ] **Step 1: Write the failing test**

Create `src/app/components/ModelSelect.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelSelect } from "./ModelSelect";

beforeEach(() => {
  // Default: catalog unavailable (offline) -> format-only validation path.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ModelSelect", () => {
  it("reveals a text field when Custom is selected", () => {
    render(<ModelSelect value="google/gemini-3.1-flash-image-preview" onChange={() => {}} />);
    expect(screen.queryByPlaceholderText("author/model-slug")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    expect(screen.getByPlaceholderText("author/model-slug")).toBeTruthy();
  });

  it("commits a well-formed slug after the debounce when offline", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<ModelSelect value="google/gemini-3.1-flash-image-preview" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    fireEvent.change(screen.getByPlaceholderText("author/model-slug"), {
      target: { value: "my/model" },
    });
    onChange.mockClear();
    vi.advanceTimersByTime(400);
    expect(onChange).toHaveBeenCalledWith("my/model");
  });

  it("switches back to a named model and hides the custom field", () => {
    const onChange = vi.fn();
    render(<ModelSelect value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    expect(screen.getByPlaceholderText("author/model-slug")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "black-forest-labs/flux-1.1-pro" },
    });
    expect(onChange).toHaveBeenCalledWith("black-forest-labs/flux-1.1-pro");
    expect(screen.queryByPlaceholderText("author/model-slug")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/app/components/ModelSelect.test.tsx`
Expected: FAIL — current component still renders the old separate input (no `author/model-slug` placeholder behind a `Custom…` option; there's no `__custom__` select value).

- [ ] **Step 3: Write the implementation (full rewrite)**

Replace the entire contents of `src/app/components/ModelSelect.tsx` with:

```tsx
"use client";
import { useEffect, useState } from "react";
import { fetchModelCatalog, evaluateSlug, TOP_MODELS, type ImageModel } from "@/core";

const CUSTOM = "__custom__";

export function ModelSelect({
  value, onChange,
}: { value: string; onChange: (id: string) => void }) {
  const [models, setModels] = useState<ImageModel[]>(TOP_MODELS);
  const [allIds, setAllIds] = useState<Set<string>>(new Set());
  const [isCustom, setIsCustom] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "invalid" | "valid">("idle");

  // Load the catalog once: image-filtered list for the dropdown + all ids for existence checks.
  useEffect(() => {
    fetchModelCatalog()
      .then((c) => { setModels(c.imageModels); setAllIds(c.allIds); })
      .catch(() => { setModels(TOP_MODELS); setAllIds(new Set()); });
  }, []);

  // Enter custom mode when the incoming value isn't a known model.
  useEffect(() => {
    if (value && !models.some((m) => m.id === value)) {
      setIsCustom(true);
      setDraft((d) => d || value);
    }
  }, [models, value]);

  // Auto-select the first model when nothing is chosen (suppressed in custom mode).
  useEffect(() => {
    if (!isCustom && !value && models.length) onChange(models[0].id);
  }, [models, value, onChange, isCustom]);

  // Debounced validation + commit while editing a custom slug.
  useEffect(() => {
    if (!isCustom) return;
    const trimmed = draft.trim();
    if (!trimmed) { setStatus("idle"); return; }
    setStatus("checking");
    const t = setTimeout(() => {
      const { status: s, commit } = evaluateSlug(trimmed, allIds, allIds.size > 0);
      setStatus(s);
      if (commit) onChange(trimmed);
    }, 400);
    return () => clearTimeout(t);
  }, [draft, isCustom, allIds, onChange]);

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === CUSTOM) {
      setIsCustom(true);
      setDraft((d) => d || (value && !models.some((m) => m.id === value) ? value : ""));
    } else {
      setIsCustom(false);
      setStatus("idle");
      onChange(v);
    }
  }

  const fieldBorder =
    status === "invalid" ? "border-red-700 focus:border-red-500"
    : status === "valid" ? "border-emerald-700 focus:border-emerald-500"
    : "border-neutral-800 focus:border-neutral-500";

  const helper =
    status === "checking" ? <span className="text-neutral-500">Checking…</span>
    : status === "valid" ? <span className="text-emerald-500">Looks good</span>
    : status === "invalid"
      ? <span className="text-red-400">
          {draft.trim() && !allIds.size ? "Invalid slug format" : "Invalid or unknown model slug"}
        </span>
    : null;

  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wide text-neutral-500">Model</label>
      <select
        value={isCustom ? CUSTOM : value}
        onChange={handleSelect}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.curated ? "★ " : ""}{m.name}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {isCustom && (
        <div className="space-y-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="author/model-slug"
            className={`w-full rounded-lg border bg-neutral-950 px-3 py-2 text-sm outline-none ${fieldBorder}`}
          />
          {helper && <p className="text-xs">{helper}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `npm run test -- src/app/components/ModelSelect.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS — no regressions, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ModelSelect.tsx src/app/components/ModelSelect.test.tsx
git commit -m "feat(web): consolidate model selection into dropdown with custom option"
```

---

### Task 5: CLI custom-slug format validation

**Files:**
- Modify: `cli/index.ts:6` (import) and the custom-slug `text` prompt (`cli/index.ts:65`).

**Interfaces:**
- Consumes: `isValidSlugFormat` (Task 1) from `../src/core/models.js`.
- Produces: no new exports.

- [ ] **Step 1: Add the import**

In `cli/index.ts`, update the models import (line 6) to include `isValidSlugFormat`:

```ts
import { fetchImageModels, isValidSlugFormat, TOP_MODELS } from "../src/core/models.js";
```

- [ ] **Step 2: Add validation to the custom-slug prompt**

Replace the custom-slug prompt (currently `const slug = await text({ message: "Custom model slug:" });`) with:

```ts
    const slug = await text({
      message: "Custom model slug:",
      validate: (v) =>
        isValidSlugFormat(v.trim()) ? undefined : "Invalid model slug (expected author/model).",
    });
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add cli/index.ts
git commit -m "feat(cli): validate custom model slug format"
```

---

## Self-Review Notes

**Spec coverage:**
- Sentinel `Custom…` option + revealed input, dropdown arrow switches back → Task 4.
- Removal of standalone input + "Use" button and synthetic custom option → Task 4 (full rewrite).
- `isValidSlugFormat` → Task 1. `fetchModelCatalog` (single fetch, image list + all ids, `fetchImageModels` retained) → Task 2. `evaluateSlug` decision table incl. offline branch → Task 3.
- Debounced format→existence validation with checking/valid/invalid UI, commit only when valid, auto-select-first suppressed in custom mode → Task 4.
- CLI `Custom slug…` format validation → Task 5.
- Tests for all pure helpers + existing tests green → Tasks 1-3; component interaction test → Task 4.

**Out of scope (per spec, YAGNI):** combobox/autocomplete, image-modality soft-warnings, persisting recent custom slugs — no tasks, intentionally.

**Type consistency:** `ModelCatalog`/`fetchModelCatalog` (Task 2) consumed in Task 4; `evaluateSlug` signature `(draft, allIds, hasCatalog)` and `SlugStatus` (Task 3) consumed in Task 4; `isValidSlugFormat` (Task 1) consumed by Tasks 3 and 5. `ModelSelect` public props unchanged, so `PromptForm` (`src/app/components/PromptForm.tsx`) needs no edit.
