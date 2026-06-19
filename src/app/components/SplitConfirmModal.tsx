"use client";
import { Scissors, X, Loader2 } from "lucide-react";

export function SplitConfirmModal({
  model, loading, onConfirm, onCancel,
}: {
  model: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Scissors className="h-4 w-4" /> Split into separate prompts
          </h2>
          <button onClick={onCancel} aria-label="Close" disabled={loading}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 text-sm text-neutral-400">
          This sends your text to <span className="text-neutral-200">{model}</span> (one quick API
          call) to detect the distinct image prompts it contains.
        </p>
        <p className="mb-5 text-sm text-neutral-400">
          You&apos;ll review and edit the extracted prompts before anything is generated.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Extracting…
              </>
            ) : (
              "Extract prompts"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
