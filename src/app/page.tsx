"use client";
import { useState } from "react";
import { Settings, KeyRound, Scissors } from "lucide-react";
import { useApiKey } from "./lib/useApiKey";
import { useGeneration } from "./lib/useGeneration";
import { useSplit } from "./lib/useSplit";
import { useSettings } from "./lib/useSettings";
import { ApiKeyDialog } from "./components/ApiKeyDialog";
import { PromptForm } from "./components/PromptForm";
import { LoadingGrid } from "./components/LoadingGrid";
import { Gallery } from "./components/Gallery";
import { SplitReview } from "./components/SplitReview";

export default function Home() {
  const { apiKey, setApiKey } = useApiKey();
  const { images, loading, savedDir, error, run, runBatch } = useGeneration();
  const { detect, aiSplit } = useSplit();
  const { splitModel, setSplitModel } = useSettings();
  const [showKey, setShowKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [count, setCount] = useState(4);
  const [splitList, setSplitList] = useState<string[] | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  const onGenerate = () => {
    if (!apiKey) return setShowKey(true);
    if (prompt.trim() && model) run({ apiKey, model, prompt: prompt.trim(), count });
  };

  const detected = detect(prompt);
  const canHeuristicSplit = detected.length > 1;

  const openSplit = () => {
    setSplitError(null);
    setSplitList(detected);
  };
  const onAiSplit = async () => {
    if (!apiKey) return setShowKey(true);
    setSplitting(true);
    setSplitError(null);
    try {
      setSplitList(await aiSplit(prompt, apiKey, splitModel));
    } catch (e) {
      setSplitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSplitting(false);
    }
  };
  const confirmSplit = () => {
    if (!apiKey) return setShowKey(true);
    if (!model) return;
    const prompts = (splitList ?? []).map((p) => p.trim()).filter(Boolean);
    if (prompts.length === 0) return;
    setSplitList(null);
    runBatch({ apiKey, model, prompts });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Image Gen</h1>
        <button
          onClick={() => setShowKey(true)}
          className="flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-800"
        >
          {apiKey ? <Settings className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          {apiKey ? "Settings" : "Set key"}
        </button>
      </header>

      <PromptForm
        prompt={prompt} setPrompt={(v) => { setSplitError(null); setPrompt(v); }}
        model={model} setModel={setModel}
        count={count} setCount={setCount}
        disabled={loading} onGenerate={onGenerate}
      />

      {prompt.trim() && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            {canHeuristicSplit ? (
              <button
                onClick={openSplit}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Scissors className="h-3.5 w-3.5" /> Split into {detected.length} prompts
              </button>
            ) : (
              <button
                onClick={onAiSplit}
                disabled={loading || splitting}
                className="flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Scissors className="h-3.5 w-3.5" /> {splitting ? "Splitting…" : "AI split"}
              </button>
            )}
          </div>
          {splitError && (
            <p className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
              {splitError}
            </p>
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

      <section className="mt-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {savedDir && (
          <p className="mb-4 text-xs text-neutral-500">Saved to {savedDir}</p>
        )}
        {loading ? <LoadingGrid count={count} /> : <Gallery images={images} />}
      </section>

      {showKey && (
        <ApiKeyDialog
          initial={apiKey}
          onSave={setApiKey}
          onClose={() => setShowKey(false)}
          splitModel={splitModel}
          onSaveSplitModel={setSplitModel}
        />
      )}
    </main>
  );
}
