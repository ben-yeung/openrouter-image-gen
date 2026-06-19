# Model Selection UI Consolidation — Design

**Date:** 2026-06-19
**Status:** Approved (design)

## Problem

Model selection in the web UI is split across two controls: a native `<select>`
dropdown of curated + live-fetched models, and a *separate* text input with a
"Use" button for entering a custom OpenRouter slug. A custom value also appears
as a synthetic `★ {value} (custom)` option at the top of the dropdown. Having two
inputs for one logical choice is unintuitive — it's unclear that the text field
relates to the dropdown, or how to get back to a named model after going custom.

## Goal

Consolidate model selection into the dropdown. "Custom" becomes an option in the
dropdown; selecting it reveals a single text field for the slug. The dropdown
arrow stays live so the user can switch from custom back to any named model. The
standalone input + "Use" button are removed. Custom slugs are validated on a
debounce: a cheap offline format check gates a network existence check against
OpenRouter's catalog.

## Approach

**Sentinel option + revealed input.** A fixed `Custom…` entry sits at the bottom
of the native `<select>`. Selecting it flips the component into custom mode and
reveals one text field below; selecting any named model switches back. This keeps
the native-select semantics (visible arrow, keyboard navigation) the requirement
calls for, and is the smallest change that fully consolidates the inputs.

Rejected alternatives:
- **Editable combobox** (one control filtering presets *and* accepting free text):
  most literally consolidated, but a larger rewrite, heavier accessibility
  surface, and loses the plain native-arrow behavior.
- **Minimal patch** (keep both controls, tidy detection): does not satisfy
  "Custom should be an option in the dropdown."

## Components

### Core — `src/core/models.ts`

**`isValidSlugFormat(slug: string): boolean`** — pure, no network. Returns true
when `slug` matches the OpenRouter shape: `author/model` with an optional `:tag`
suffix. Each segment is `[a-zA-Z0-9._-]+`; exactly one `/`; optional single `:tag`
where tag is `[a-zA-Z0-9._-]+`. Leading/trailing whitespace is the caller's
concern (trim before calling).

Reference regex: `^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(:[a-zA-Z0-9._-]+)?$`

**`fetchModelCatalog(fetchImpl?): Promise<{ imageModels: ImageModel[]; allIds: Set<string> }>`**
— performs the single existing fetch to `https://openrouter.ai/api/v1/models`
and returns both:
- `imageModels`: curated ★ merged with live models filtered to `image` output
  modality (current `fetchImageModels` behavior).
- `allIds`: a `Set` of *every* model id in the catalog (not just image models),
  used for existence checks of custom slugs.

On fetch failure / non-ok response: `imageModels` falls back to `TOP_MODELS` and
`allIds` is an empty set (signals "catalog unavailable" to callers).

**`fetchImageModels(fetchImpl?)`** is retained and delegates to
`fetchModelCatalog`, returning only `imageModels`. This keeps the CLI and existing
tests untouched.

**`evaluateSlug(draft: string, allIds: Set<string>, hasCatalog: boolean): { status: "idle" | "invalid" | "valid"; commit: boolean }`**
— pure decision function (no network, no React) so the gating logic is
unit-testable in isolation. `draft` is assumed already trimmed.

| draft / state                                   | status    | commit |
|-------------------------------------------------|-----------|--------|
| empty                                           | `idle`    | false  |
| bad format                                      | `invalid` | false  |
| good format, `hasCatalog`, id ∈ allIds          | `valid`   | true   |
| good format, `hasCatalog`, id ∉ allIds          | `invalid` | false  |
| good format, `!hasCatalog` (offline / failed)   | `valid`   | true   |

The last row is graceful degradation: if the catalog couldn't load we cannot prove
non-existence, so we accept any well-formed slug (format-only validation).

`hasCatalog` is derived by the caller as `allIds.size > 0`.

### Web — `src/app/components/ModelSelect.tsx`

State:
- `models: ImageModel[]` — dropdown options (image-filtered).
- `allIds: Set<string>` — for existence validation.
- `isCustom: boolean` — initialized true when incoming `value` is non-empty and
  not a known model id; otherwise false. Recomputed when models load.
- `draft: string` — the custom slug being edited.
- `status: "idle" | "checking" | "invalid" | "valid"` — drives field styling and
  helper text. (`checking` is the transient UI state during the async existence
  step; `evaluateSlug` itself only returns idle/invalid/valid.)

Dropdown (`<select>`):
- Options: every model, then a trailing `Custom…` sentinel (`value="__custom__"`).
- Displayed value: `__custom__` when `isCustom`, else `value`.
- onChange:
  - `__custom__` → enter custom mode; reveal and focus the text field; seed
    `draft` from the current `value` if it was a custom slug, else keep the
    existing `draft` (so re-selecting Custom restores prior input).
  - any model id → exit custom mode; `onChange(id)`.
- The synthetic `★ {value} (custom)` option is removed — custom values now live in
  the revealed field, and the select simply shows `Custom…`.

Custom field (rendered only when `isCustom`):
- Single text input bound to `draft`; updates on every keystroke.
- Debounced ~400ms after the last keystroke: trim, run `isValidSlugFormat`. If the
  format is bad → `status = "invalid"`, no commit. If the format is good and a
  catalog is loaded → `status = "checking"` briefly, then apply `evaluateSlug`
  with the loaded `allIds`; if the catalog is unavailable, `evaluateSlug`'s
  offline branch yields `valid`/commit. On `valid` → `onChange(draft)`.
- Border color + small helper text reflect the status: neutral (idle), amber
  (checking), green (valid), red (invalid, with a short reason — "invalid slug
  format" or "not found on OpenRouter").
- Only commits to the parent when `status` resolves to `valid`.

Existing auto-select-first effect (`if (!value && models.length) onChange(models[0].id)`)
is retained but suppressed while `isCustom` is true.

### CLI — `cli/index.ts`

Already consolidated (a `Custom slug…` select option leading to a `text` prompt).
Add `validate: (v) => isValidSlugFormat(v.trim()) ? undefined : "Invalid model slug"`
to that `text` prompt for consistency. Format-only; existence surfaces naturally
at generate time. Small and optional but cheap.

## Data Flow

1. On mount, `ModelSelect` calls `fetchModelCatalog()` → sets `models` + `allIds`.
   On failure, `models = TOP_MODELS`, `allIds = ∅`.
2. User picks a named model → `onChange(id)` immediately; form uses it.
3. User picks `Custom…` → field appears; typing debounces → format gate →
   existence check (or offline fallback) → `evaluateSlug` → `onChange(draft)` only
   when valid.
4. Parent (`PromptForm`) is unchanged: it still passes `model` / `setModel` and
   receives a committed slug string.

## Error Handling

- Catalog fetch failure: dropdown falls back to `TOP_MODELS`; custom validation
  degrades to format-only (cannot prove non-existence).
- Invalid format: inline red helper text; no commit; parent retains its last
  committed value.
- Well-formed but unknown slug (catalog loaded): inline red "not found"; no commit.

## Testing

- `isValidSlugFormat`: valid (`a/b`, `author/model-name`, `a/b:tag`,
  dotted/dashed segments) and invalid (no slash, multiple slashes, empty segment,
  spaces, trailing colon).
- `evaluateSlug`: every row of the decision table, including the offline
  (`!hasCatalog`) commit branch and the catalog-loaded "not found" branch.
- `fetchModelCatalog`: one fetch yields `imageModels` (image-filtered, curated
  merged) and `allIds` containing *all* ids (including text-only); failure →
  `TOP_MODELS` + empty set.
- Existing `fetchImageModels` / `mergeModels` tests remain green.

## Out of Scope (YAGNI)

- Combobox / autocomplete / type-to-filter.
- Image-modality soft-warnings when a custom slug is a non-image model.
- Persisting or suggesting recently-used custom slugs.
