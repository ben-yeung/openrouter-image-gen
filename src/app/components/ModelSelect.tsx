"use client";
import { useEffect, useState } from "react";
import { fetchImageModels, TOP_MODELS, type ImageModel } from "@/core";

export function ModelSelect({
  value, onChange,
}: { value: string; onChange: (id: string) => void }) {
  const [models, setModels] = useState<ImageModel[]>(TOP_MODELS);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    fetchImageModels().then(setModels).catch(() => setModels(TOP_MODELS));
  }, []);

  useEffect(() => {
    if (!value && models.length) onChange(models[0].id);
  }, [models, value, onChange]);

  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wide text-neutral-500">Model</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.curated ? "★ " : ""}{m.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="custom/model-slug"
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="button"
          onClick={() => custom.trim() && onChange(custom.trim())}
          className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
        >
          Use
        </button>
      </div>
    </div>
  );
}
