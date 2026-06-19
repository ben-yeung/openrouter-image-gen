"use client";
import { useState } from "react";
import { KeyRound, X } from "lucide-react";

export function ApiKeyDialog({
  initial, onSave, onClose,
}: { initial: string; onSave: (k: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <KeyRound className="h-4 w-4" /> OpenRouter API key
          </h2>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-sm text-neutral-400">
          Stored only in your browser. Get one at openrouter.ai/keys.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-or-..."
          className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          onClick={() => { onSave(value.trim()); onClose(); }}
          className="w-full rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Save
        </button>
      </div>
    </div>
  );
}
