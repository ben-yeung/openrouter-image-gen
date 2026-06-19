# Reroll Image Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-card "Reroll" button that appears on hover and regenerates that image slot with a new random seed, working in both variations and batch mode.

**Architecture:** `useGeneration` stores the last-used generation params and a `rerolling: Set<number>` of in-flight indices, then exposes a `reroll(index)` method that calls `generateImage` and updates just that slot. `Gallery` threads the new props to `ImageCard`, which renders the reroll button in the existing hover overlay alongside "Save".

**Tech Stack:** React (Next.js App Router), TypeScript, lucide-react, Vitest + @testing-library/react

## Global Constraints

- Keep the `rerolling` state as a `Set<number>` — always produce a new `Set` instance when mutating so React detects the change.
- `generateImage` is already exported from `@/core` (via `src/core/index.ts → src/core/generate.ts`).
- Icons must come from `lucide-react` (already a dependency).
- Test files use `// @vitest-environment jsdom` and `@testing-library/react`.
- Run tests with: `npx vitest run`

---

### Task 1: Update `useGeneration` — store last params, add `rerolling` state and `reroll` method

**Files:**
- Modify: `src/app/lib/useGeneration.ts`
- Create: `src/app/lib/useGeneration.test.ts`

**Interfaces:**
- Produces: `rerolling: Set<number>`, `reroll: (index: number) => Promise<void>` added to the hook return value

---

- [ ] **Step 1: Write the failing tests**

Create `src/app/lib/useGeneration.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/core", () => ({
  generateVariations: vi.fn(),
  generateBatch: vi.fn(),
  generateImage: vi.fn(),
  batchLabel: (prompts: string[]) => prompts.join(" | "),
}));

import { generateVariations, generateBatch, generateImage } from "@/core";
import { useGeneration } from "./useGeneration";

const img = (i: number, extra: Record<string, unknown> = {}) => ({
  index: i,
  dataUrl: `data:image/png;base64,AAA${i}`,
  seed: 100 + i,
  ...extra,
});

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ dir: "/tmp" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("useGeneration reroll", () => {
  it("exposes rerolling as an empty Set and reroll as a function", () => {
    const { result } = renderHook(() => useGeneration());
    expect(result.current.rerolling).toBeInstanceOf(Set);
    expect(result.current.rerolling.size).toBe(0);
    expect(typeof result.current.reroll).toBe("function");
  });

  it("no-ops when called before any generation has run", async () => {
    const { result } = renderHook(() => useGeneration());
    await act(async () => { await result.current.reroll(0); });
    expect(vi.mocked(generateImage)).not.toHaveBeenCalled();
  });

  it("calls generateImage with the stored apiKey, model, prompt, and the slot index", async () => {
    vi.mocked(generateVariations).mockResolvedValue([img(0), img(1)]);
    vi.mocked(generateImage).mockResolvedValue(img(0, { seed: 999 }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "sk-test", model: "flux/dev", prompt: "a fox", count: 2 });
    });
    await act(async () => { await result.current.reroll(0); });

    expect(vi.mocked(generateImage)).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test", model: "flux/dev", prompt: "a fox", index: 0 }),
    );
  });

  it("replaces only the rerolled slot; other slots are unchanged", async () => {
    const original = [img(0), img(1)];
    vi.mocked(generateVariations).mockResolvedValue(original);
    const fresh = img(0, { seed: 999, dataUrl: "data:image/png;base64,NEW" });
    vi.mocked(generateImage).mockResolvedValue(fresh);

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "k", model: "m", prompt: "p", count: 2 });
    });
    await act(async () => { await result.current.reroll(0); });

    expect(result.current.images[0]).toEqual(fresh);
    expect(result.current.images[1]).toEqual(original[1]);
  });

  it("uses image.prompt (not lastParams.prompt) when rerolling a batch card", async () => {
    vi.mocked(generateBatch).mockResolvedValue([
      img(0, { prompt: "a cat" }),
      img(1, { prompt: "a dog" }),
    ]);
    vi.mocked(generateImage).mockResolvedValue(img(1, { prompt: "a dog" }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.runBatch({ apiKey: "k", model: "m", prompts: ["a cat", "a dog"] });
    });
    await act(async () => { await result.current.reroll(1); });

    expect(vi.mocked(generateImage)).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a dog", index: 1 }),
    );
  });

  it("clears the index from rerolling after the call resolves", async () => {
    vi.mocked(generateVariations).mockResolvedValue([img(0)]);
    vi.mocked(generateImage).mockResolvedValue(img(0, { seed: 42 }));

    const { result } = renderHook(() => useGeneration());
    await act(async () => {
      await result.current.run({ apiKey: "k", model: "m", prompt: "p", count: 1 });
    });
    await act(async () => { await result.current.reroll(0); });

    expect(result.current.rerolling.has(0)).toBe(false);
    expect(result.current.rerolling.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx vitest run src/app/lib/useGeneration.test.ts
```

Expected: tests fail because `rerolling` and `reroll` don't exist yet.

- [ ] **Step 3: Update `useGeneration.ts`**

Replace the full contents of `src/app/lib/useGeneration.ts`:

```ts
"use client";
import { useState } from "react";
import { generateVariations, generateBatch, generateImage, batchLabel, type GeneratedImage } from "@/core";

export function useGeneration() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedDir, setSavedDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastParams, setLastParams] = useState<{ apiKey: string; model: string; prompt: string } | null>(null);
  const [rerolling, setRerolling] = useState<Set<number>>(new Set());

  async function run(args: { apiKey: string; model: string; prompt: string; count: number }) {
    setLastParams({ apiKey: args.apiKey, model: args.model, prompt: args.prompt });
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
        setError(results[0]?.error || "No images were generated.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runBatch(args: { apiKey: string; model: string; prompts: string[] }) {
    setLastParams({ apiKey: args.apiKey, model: args.model, prompt: args.prompts[0] ?? "" });
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function reroll(index: number) {
    if (!lastParams) return;
    const image = images[index];
    if (!image) return;
    const prompt = image.prompt ?? lastParams.prompt;
    const seed = Math.floor(Math.random() * 1_000_000_000);
    setRerolling((prev) => new Set(prev).add(index));
    const result = await generateImage({
      apiKey: lastParams.apiKey,
      model: lastParams.model,
      prompt,
      seed,
      index,
    });
    setImages((prev) => prev.map((img, i) => (i === index ? result : img)));
    setRerolling((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }

  return { images, loading, savedDir, error, rerolling, run, runBatch, reroll };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx vitest run src/app/lib/useGeneration.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/useGeneration.ts src/app/lib/useGeneration.test.ts
git commit -m "feat: add reroll method and rerolling state to useGeneration"
```

---

### Task 2: Update `ImageCard` — reroll button and per-card loading overlay

**Files:**
- Modify: `src/app/components/ImageCard.tsx`
- Create: `src/app/components/ImageCard.test.tsx`

**Interfaces:**
- Consumes: `rerolling: Set<number>`, `reroll: (index: number) => void` from Task 1
- Produces: `ImageCard` now accepts optional `onReroll?: (index: number) => void` and `rerolling?: Set<number>` props

---

- [ ] **Step 1: Write the failing tests**

Create `src/app/components/ImageCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageCard } from "./ImageCard";
import type { GeneratedImage } from "@/core";

const img = (i: number, extra: Partial<GeneratedImage> = {}): GeneratedImage => ({
  index: i,
  dataUrl: `data:image/png;base64,AAA${i}`,
  seed: 100 + i,
  ...extra,
});

describe("ImageCard reroll", () => {
  it("renders a reroll button when onReroll is provided", () => {
    render(<ImageCard image={img(0)} onReroll={vi.fn()} rerolling={new Set()} />);
    expect(screen.getByLabelText("Reroll image 1")).toBeTruthy();
  });

  it("does not render a reroll button when onReroll is not provided", () => {
    render(<ImageCard image={img(0)} rerolling={new Set()} />);
    expect(screen.queryByLabelText("Reroll image 1")).toBeNull();
  });

  it("calls onReroll with the correct image index when clicked", () => {
    const onReroll = vi.fn();
    render(<ImageCard image={img(2)} onReroll={onReroll} rerolling={new Set()} />);
    fireEvent.click(screen.getByLabelText("Reroll image 3"));
    expect(onReroll).toHaveBeenCalledWith(2);
    expect(onReroll).toHaveBeenCalledTimes(1);
  });

  it("disables the reroll button when this card's index is in rerolling", () => {
    render(<ImageCard image={img(0)} onReroll={vi.fn()} rerolling={new Set([0])} />);
    const btn = screen.getByLabelText("Reroll image 1") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("does not disable the reroll button when a different card is rerolling", () => {
    render(<ImageCard image={img(0)} onReroll={vi.fn()} rerolling={new Set([1])} />);
    const btn = screen.getByLabelText("Reroll image 1") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("does not render a reroll button for error cards", () => {
    render(
      <ImageCard
        image={{ index: 0, dataUrl: "", error: "Request failed (500)" }}
        onReroll={vi.fn()}
        rerolling={new Set()}
      />,
    );
    expect(screen.queryByLabelText("Reroll image 1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx vitest run src/app/components/ImageCard.test.tsx
```

Expected: tests fail because `onReroll` and `rerolling` props don't exist yet.

- [ ] **Step 3: Update `ImageCard.tsx`**

Replace the full contents of `src/app/components/ImageCard.tsx`:

```tsx
"use client";
import { Download, ImageOff, RefreshCw, Loader2 } from "lucide-react";
import type { GeneratedImage } from "@/core";

export function ImageCard({
  image,
  onOpen,
  onReroll,
  rerolling = new Set(),
}: {
  image: GeneratedImage;
  onOpen?: () => void;
  onReroll?: (index: number) => void;
  rerolling?: Set<number>;
}) {
  if (image.error || !image.dataUrl) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-center text-xs text-neutral-500">
        <ImageOff className="h-5 w-5" />
        <span>{image.error ?? "Failed"}</span>
      </div>
    );
  }

  const isRerolling = rerolling.has(image.index);

  return (
    <div className="group overflow-hidden rounded-xl border border-neutral-800">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`View generated image ${image.index + 1}`}
          className="block w-full cursor-zoom-in"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.dataUrl}
            alt={`Generated image ${image.index + 1}`}
            className={`aspect-square w-full object-cover transition-opacity${isRerolling ? " opacity-50" : ""}`}
          />
        </button>
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          {onReroll && (
            <button
              type="button"
              onClick={() => onReroll(image.index)}
              disabled={isRerolling}
              aria-label={`Reroll image ${image.index + 1}`}
              className="flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs disabled:cursor-not-allowed"
            >
              {isRerolling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}{" "}
              Reroll
            </button>
          )}
          <a
            href={image.dataUrl}
            download={`image-${image.index + 1}.png`}
            className="flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs"
          >
            <Download className="h-3.5 w-3.5" /> Save
          </a>
        </div>
      </div>
      {image.prompt && (
        <p className="line-clamp-2 px-2 py-1.5 text-xs text-neutral-400">{image.prompt}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx vitest run src/app/components/ImageCard.test.tsx
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/ImageCard.tsx src/app/components/ImageCard.test.tsx
git commit -m "feat: add reroll button and loading overlay to ImageCard"
```

---

### Task 3: Thread props through `Gallery` and wire into `page.tsx`

**Files:**
- Modify: `src/app/components/Gallery.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `rerolling: Set<number>` and `reroll: (index: number) => Promise<void>` from Task 1; `ImageCard` accepting `onReroll` and `rerolling` from Task 2
- Produces: `<Gallery onReroll rerolling>` wired end-to-end from `page.tsx`

---

- [ ] **Step 1: Update `Gallery.tsx`**

Replace the full contents of `src/app/components/Gallery.tsx`:

```tsx
"use client";
import { useState } from "react";
import { DownloadCloud } from "lucide-react";
import type { GeneratedImage } from "@/core";
import { ImageCard } from "./ImageCard";
import { Lightbox } from "./Lightbox";

export function Gallery({
  images,
  onReroll,
  rerolling,
}: {
  images: GeneratedImage[];
  onReroll?: (index: number) => void;
  rerolling?: Set<number>;
}) {
  const ok = images.filter((i) => i.dataUrl && !i.error);
  const [selected, setSelected] = useState<number | null>(null);

  const downloadAll = () => {
    ok.forEach((img) => {
      const a = document.createElement("a");
      a.href = img.dataUrl;
      a.download = `image-${img.index + 1}.png`;
      a.click();
    });
  };

  const step = (delta: number) =>
    setSelected((i) => (i === null ? i : (i + delta + ok.length) % ok.length));

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
          <ImageCard
            key={img.index}
            image={img}
            onOpen={img.dataUrl && !img.error ? () => setSelected(ok.indexOf(img)) : undefined}
            onReroll={onReroll}
            rerolling={rerolling}
          />
        ))}
      </div>

      {selected !== null && ok[selected] && (
        <Lightbox
          images={ok}
          index={selected}
          onClose={() => setSelected(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `page.tsx` — destructure `rerolling` and `reroll`, pass to `<Gallery>`**

In `src/app/page.tsx`, make two changes:

**Line 17** — update the destructuring of `useGeneration()`:
```ts
// Before:
const { images, loading, savedDir, error, run, runBatch } = useGeneration();
// After:
const { images, loading, savedDir, error, rerolling, run, runBatch, reroll } = useGeneration();
```

**Line 119** — update the `<Gallery>` call:
```tsx
// Before:
{loading ? <LoadingGrid count={count} /> : <Gallery images={images} />}
// After:
{loading ? <LoadingGrid count={count} /> : <Gallery images={images} onReroll={reroll} rerolling={rerolling} />}
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```
npx vitest run
```

Expected: all tests pass, no type errors.

- [ ] **Step 4: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Gallery.tsx src/app/page.tsx
git commit -m "feat: wire reroll through Gallery and page — reroll on hover complete"
```
