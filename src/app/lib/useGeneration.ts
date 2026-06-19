"use client";
import { useState } from "react";
import { generateVariations, generateBatch, generateImage, batchLabel, type GeneratedImage } from "@/core";

export function useGeneration() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedDir, setSavedDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastParams, setLastParams] = useState<{ apiKey: string; model: string; prompt: string } | null>(null);
  const [rerolling, setRerolling] = useState<Set<number>>(new Set());

  async function run(args: { apiKey: string; model: string; prompt: string; count: number }) {
    setLastParams({ apiKey: args.apiKey, model: args.model, prompt: args.prompt });
    setLoading(true);
    setError(null);
    setSavedDir(null);
    setImages([]);
    try {
      const results = await generateVariations(
        { apiKey: args.apiKey, model: args.model, prompt: args.prompt },
        args.count,
      );
      setImages(results);

      const successful = results.filter((r) => r.dataUrl && !r.error);
      if (successful.length > 0) {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: args.prompt, model: args.model, images: successful }),
        });
        if (res.ok) {
          const json = await res.json();
          setSavedDir(json.dir);
        } else {
          setError("Images generated but could not be saved to disk.");
        }
      } else {
        setError(results[0]?.error || "No images were generated.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runBatch(args: { apiKey: string; model: string; prompts: string[] }) {
    setLastParams({ apiKey: args.apiKey, model: args.model, prompt: args.prompts[0] ?? "" });
    setLoading(true);
    setError(null);
    setSavedDir(null);
    setImages([]);
    try {
      const results = await generateBatch(args.prompts, {
        apiKey: args.apiKey,
        model: args.model,
      });
      setImages(results);

      const successful = results.filter((r) => r.dataUrl && !r.error);
      if (successful.length > 0) {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: batchLabel(args.prompts),
            model: args.model,
            kind: "batch",
            images: successful,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setSavedDir(json.dir);
        } else {
          setError("Images generated but could not be saved to disk.");
        }
      } else {
        setError(results[0]?.error ?? "No images were generated.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function reroll(index: number) {
    if (!lastParams) return;
    const image = images[index];
    if (!image) return;
    const prompt = image.prompt ?? lastParams.prompt;
    const seed = Math.floor(Math.random() * 1_000_000_000);
    setRerolling((prev) => new Set(prev).add(index));
    try {
      const result = await generateImage({
        apiKey: lastParams.apiKey,
        model: lastParams.model,
        prompt,
        seed,
        index,
      });
      setImages((prev) => prev.map((img, i) => (i === index ? result : img)));
    } finally {
      setRerolling((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  }

  return { images, loading, savedDir, error, rerolling, run, runBatch, reroll };
}
