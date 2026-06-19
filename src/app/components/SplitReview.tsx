"use client";
import { Trash2, Plus, Sparkles, X } from "lucide-react";

const WARN_THRESHOLD = 12;

export function SplitReview({
  prompts, onChange, onConfirm, onCancel, busy = false,
}: {
  prompts: string[];
  onChange: (next: string[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
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
