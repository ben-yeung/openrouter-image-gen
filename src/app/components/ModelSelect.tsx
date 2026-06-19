"use client";
import { useEffect, useState } from "react";
import { fetchModelCatalog, evaluateSlug, TOP_MODELS, type ImageModel } from "@/core";

const CUSTOM = "__custom__";

export function ModelSelect({
  value, onChange,
}: { value: string; onChange: (id: string) => void }) {
  const [models, setModels] = useState<ImageModel[]>(TOP_MODELS);
  const [allIds, setAllIds] = useState<Set<string>>(new Set());
  const [isCustom, setIsCustom] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "invalid" | "valid">("idle");

  // Load the catalog once: image-filtered list for the dropdown + all ids for existence checks.
  useEffect(() => {
    fetchModelCatalog()
      .then((c) => { setModels(c.imageModels); setAllIds(c.allIds); })
      .catch(() => { setModels(TOP_MODELS); setAllIds(new Set()); });
  }, []);

  // Enter custom mode when the incoming value isn't a known model.
  useEffect(() => {
    if (value && !models.some((m) => m.id === value)) {
      setIsCustom(true);
      setDraft((d) => d || value);
    }
  }, [models, value]);

  // Auto-select the first model when nothing is chosen (suppressed in custom mode).
  useEffect(() => {
    if (!isCustom && !value && models.length) onChange(models[0].id);
  }, [models, value, onChange, isCustom]);

  // Debounced validation + commit while editing a custom slug.
  useEffect(() => {
    if (!isCustom) return;
    const trimmed = draft.trim();
    if (!trimmed) { setStatus("idle"); return; }
    setStatus("checking");
    const t = setTimeout(() => {
      const { status: s, commit } = evaluateSlug(trimmed, allIds, allIds.size > 0);
      setStatus(s);
      if (commit) onChange(trimmed);
    }, 400);
    return () => clearTimeout(t);
  }, [draft, isCustom, allIds, onChange]);

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === CUSTOM) {
      setIsCustom(true);
      setDraft((d) => d || (value && !models.some((m) => m.id === value) ? value : ""));
    } else {
      setIsCustom(false);
      setStatus("idle");
      onChange(v);
    }
  }

  const fieldBorder =
    status === "invalid" ? "border-red-700 focus:border-red-500"
    : status === "valid" ? "border-emerald-700 focus:border-emerald-500"
    : "border-neutral-800 focus:border-neutral-500";

  const helper =
    status === "checking" ? <span className="text-neutral-500">Checking…</span>
    : status === "valid" ? <span className="text-emerald-500">Looks good</span>
    : status === "invalid"
      ? <span className="text-red-400">
          {draft.trim() && !allIds.size ? "Invalid slug format" : "Invalid or unknown model slug"}
        </span>
    : null;

  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wide text-neutral-500">Model</label>
      <select
        value={isCustom ? CUSTOM : value}
        onChange={handleSelect}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.curated ? "★ " : ""}{m.name}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {isCustom && (
        <div className="space-y-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="author/model-slug"
            className={`w-full rounded-lg border bg-neutral-950 px-3 py-2 text-sm outline-none ${fieldBorder}`}
          />
          {helper && <p className="text-xs">{helper}</p>}
        </div>
      )}
    </div>
  );
}
