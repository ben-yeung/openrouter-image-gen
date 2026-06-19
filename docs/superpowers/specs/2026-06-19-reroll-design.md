# Reroll Image Feature — Design Spec

**Date:** 2026-06-19  
**Status:** Approved

## Overview

Add a "Reroll" button to each generated image card that appears on hover alongside the existing "Save" button. Clicking it regenerates that specific image slot with a new random seed, in place, without disturbing other cards. Works in both variations mode (shared prompt) and batch mode (per-image prompt).

---

## Architecture

No new files. Changes are contained to:

- `src/app/lib/useGeneration.ts` — adds stored last-params, `rerolling` state, and `reroll` method
- `src/app/components/Gallery.tsx` — threads `onReroll` and `rerolling` props to `ImageCard`
- `src/app/components/ImageCard.tsx` — renders the reroll button and per-card loading overlay
- `src/app/page.tsx` — passes `onReroll` and `rerolling` from `useGeneration` to `<Gallery>`

---

## Data & State (`useGeneration`)

### New state

```ts
lastParams: { apiKey: string; model: string; prompt: string } | null
rerolling: Set<number>   // indices currently regenerating
```

`lastParams` is set at the top of both `run` (variations) and `runBatch` (batch) before any async work begins. It stores the shared `prompt` for variations; for batch the per-image prompt is recovered from `image.prompt`.

`rerolling` is a `Set<number>`. Multiple cards can reroll simultaneously; each index is added on start and removed on completion (success or error).

### `reroll(index: number)`

```
1. Guard: if lastParams is null or images[index] is missing, no-op.
2. prompt = images[index].prompt ?? lastParams.prompt
3. seed  = Math.floor(Math.random() * 1_000_000_000)
4. Add index to rerolling (new Set to trigger re-render).
5. Call generateImage({ apiKey: lastParams.apiKey, model: lastParams.model, prompt, seed, index }).
6. Replace images[index] with the result (new array to trigger re-render).
7. Remove index from rerolling (new Set).
```

Error results from `generateImage` are written back to the slot like any other result (the `GeneratedImage` type already carries an `error` field). No separate error-state needed.

---

## Props Threading

### `Gallery`

```ts
interface GalleryProps {
  images: GeneratedImage[];
  onReroll?: (index: number) => void;   // new
  rerolling?: Set<number>;              // new
}
```

Both props are optional so existing call sites without reroll support compile without changes.

`Gallery` passes them through to each `ImageCard`.

### `ImageCard`

```ts
interface ImageCardProps {
  image: GeneratedImage;
  onOpen?: () => void;
  onReroll?: (index: number) => void;  // new
  rerolling?: Set<number>;             // new
}
```

---

## UI (`ImageCard`)

### Hover overlay layout

The existing "Save" anchor sits at `absolute bottom-2 right-2`. The reroll button joins it in the same overlay row:

```
[ Reroll ]  [ Save ]
```

Both use the same base classes: `rounded-lg bg-black/70 px-2 py-1 text-xs opacity-0 transition group-hover:opacity-100`.

The wrapper for the two-button row is `absolute bottom-2 right-2 flex gap-1`.

### Reroll button states

| Condition | Icon | Behaviour |
|---|---|---|
| Idle | `RefreshCw` (lucide-react) + "Reroll" label | Calls `onReroll(image.index)` |
| `rerolling.has(image.index)` | `Loader2` spinning + "Reroll" label | `disabled`, cursor-not-allowed |

When `rerolling.has(image.index)`, the `<img>` gets `opacity-50` to signal the slot is being replaced.

### Error cards

The `ImageOff` error state renders no reroll button. These cards may have no recoverable prompt in the `batch` case where the image never returned data.

---

## Scope exclusions

- No persistence of rerolled images to disk (the session is already saved; rerolls are ephemeral in this iteration).
- No undo / restore of the previous image after reroll.
- No reroll from the Lightbox view.

---

## Success criteria

- Hovering a successful image card shows both "Reroll" and "Save" buttons.
- Clicking "Reroll" replaces only that card's image in place; other cards are unaffected.
- The rerolling card shows a spinner overlay and the old image dims while loading.
- Multiple cards can reroll simultaneously.
- Works in both variations mode and batch mode.
- Error cards do not show a reroll button.
