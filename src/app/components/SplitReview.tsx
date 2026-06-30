"use client";
import { Trash2, Plus, Sparkles, X } from "lucide-react";
import type { SplitItem } from "@/core";

const WARN_THRESHOLD = 12;

export function SplitReview({
  items, onChange, onConfirm, onCancel, busy = false,
}: {
  items: SplitItem[];
  onChange: (next: SplitItem[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const setAt = (i: number, value: string) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, prompt: value } : it)));
  const setPathAt = (i: number, value: string) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, path: value || undefined } : it)));
  const removeAt = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  // Shown once at the top rather than duplicated per row: applied uniformly
  // to every item so they all share the same suffix at generation time.
  const suffix = items.find((it) => it.suffix)?.suffix ?? "";
  const setSuffix = (value: string) =>
    onChange(items.map((it) => ({ ...it, suffix: value || undefined })));
  const addRow = () => onChange([...items, { prompt: "", ...(suffix ? { suffix } : {}) }]);

  const n = items.filter((it) => it.prompt.trim()).length;
  const large = n >= WARN_THRESHOLD;

  return (
    <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Review prompts to generate</h2>
        <button onClick={onCancel} aria-label="Cancel split"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex items-center gap-2 border-b border-neutral-800/60 pb-4">
        <span className="w-6" aria-hidden="true" />
        <div className="flex-1 space-y-1">
          <label htmlFor="split-suffix" className="block text-xs text-neutral-400">
            Style suffix <span className="text-neutral-600">(applied to every prompt at generation time)</span>
          </label>
          <input
            id="split-suffix"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            placeholder="Style suffix (optional)"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-1.5 text-sm text-neutral-300 outline-none focus:border-neutral-500"
          />
        </div>
        <button onClick={() => setSuffix("")} aria-label="Clear style suffix">
          <Trash2 className="h-4 w-4 text-neutral-500 hover:text-neutral-300" />
        </button>
      </div>

      <ul className="space-y-4">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex items-center gap-2 border-b border-neutral-800/60 pb-4 last:border-b-0 last:pb-0"
          >
            <span className="w-6 text-right text-xs text-neutral-500">{i + 1}.</span>
            <div className="flex-1 space-y-1">
              <input
                value={it.prompt}
                onChange={(e) => setAt(i, e.target.value)}
                aria-label={`Prompt ${i + 1}`}
                placeholder="Prompt"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
              <input
                value={it.path ?? ""}
                onChange={(e) => setPathAt(i, e.target.value)}
                aria-label={`Output name ${i + 1}`}
                placeholder="Output name (optional), e.g. villa/01.jpg"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-1 text-xs text-neutral-400 outline-none focus:border-neutral-500"
              />
            </div>
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
        </span>
        <button
          onClick={onConfirm}
          disabled={n === 0 || busy}
          className="flex items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" /> {busy ? "Generating…" : `Generate ${n}`}
        </button>
      </div>
    </div>
  );
}
