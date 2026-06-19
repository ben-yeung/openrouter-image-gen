"use client";
import { useState } from "react";
import { Settings, KeyRound } from "lucide-react";
import { useApiKey } from "./lib/useApiKey";
import { useGeneration } from "./lib/useGeneration";
import { ApiKeyDialog } from "./components/ApiKeyDialog";
import { PromptForm } from "./components/PromptForm";
import { LoadingGrid } from "./components/LoadingGrid";
import { Gallery } from "./components/Gallery";

export default function Home() {
  const { apiKey, setApiKey } = useApiKey();
  const { images, loading, savedDir, error, run } = useGeneration();
  const [showKey, setShowKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [count, setCount] = useState(4);

  const onGenerate = () => {
    if (!apiKey) return setShowKey(true);
    if (prompt.trim() && model) run({ apiKey, model, prompt: prompt.trim(), count });
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
        prompt={prompt} setPrompt={setPrompt}
        model={model} setModel={setModel}
        count={count} setCount={setCount}
        disabled={loading} onGenerate={onGenerate}
      />

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
        <ApiKeyDialog initial={apiKey} onSave={setApiKey} onClose={() => setShowKey(false)} />
      )}
    </main>
  );
}
