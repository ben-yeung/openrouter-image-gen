"use client";
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { ModelSelect } from "./ModelSelect";

export function PromptForm({
  prompt, setPrompt, model, setModel, count, setCount, disabled, onGenerate, secondaryAction,
}: {
  prompt: string; setPrompt: (v: string) => void;
  model: string; setModel: (v: string) => void;
  count: number; setCount: (n: number) => void;
  disabled: boolean; onGenerate: () => void;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
      <ModelSelect value={model} onChange={setModel} />
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-neutral-500">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="A serene mountain lake at dawn, cinematic lighting…"
          className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-neutral-500">Variations</label>
          <input
            type="number" min={1} max={8} value={count}
            onChange={(e) => setCount(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
            className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 py-2 pl-3 pr-3 text-sm outline-none focus:border-neutral-500 [&::-webkit-inner-spin-button]:mr-1"
          />
        </div>
        <div className="flex items-center gap-2">
          {secondaryAction}
          <button
            onClick={onGenerate}
            disabled={disabled}
            className="flex items-center gap-2 rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" /> Generate
          </button>
        </div>
      </div>
    </div>
  );
}
