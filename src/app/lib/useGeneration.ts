"use client";
import { useState } from "react";
import { generateVariations, generateBatch, generateImage, batchLabel, type GeneratedImage, type SplitItem } from "@/core";

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
    // Seed one pending placeholder per slot so the grid renders immediately and
    // each image can drop into its slot the moment it arrives.
    setImages(Array.from({ length: args.count }, (_, i) => ({ index: i, dataUrl: "", pending: true })));
    try {
      const results = await generateVariations(
        { apiKey: args.apiKey, model: args.model, prompt: args.prompt },
        args.count,
        { onResult: (image) => setImages((prev) => prev.map((img) => (img.index === image.index ? image : img))) },
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

  async function runBatch(args: { apiKey: string; model: string; items: SplitItem[] }) {
    const prompts = args.items.map((item) => item.prompt);
    setLastParams({ apiKey: args.apiKey, model: args.model, prompt: prompts[0] ?? "" });
    setLoading(true);
    setError(null);
    setSavedDir(null);
    // Seed pending placeholders carrying each slot's prompt/path so they show
    // their label while generating and fill in as results stream back.
    setImages(
      args.items.map((item, i) => ({
        index: i,
        dataUrl: "",
        pending: true,
        prompt: item.prompt,
        ...(item.path ? { path: item.path } : {}),
      })),
    );
    try {
      const results = await generateBatch(
        prompts,
        { apiKey: args.apiKey, model: args.model },
        {
          onResult: (image) => {
            const path = args.items[image.index]?.path;
            const withPath = path ? { ...image, path } : image;
            setImages((prev) => prev.map((img) => (img.index === image.index ? withPath : img)));
          },
        },
      );
      const withPaths = results.map((r, i) =>
        args.items[i]?.path ? { ...r, path: args.items[i].path } : r,
      );
      setImages(withPaths);

      const successful = withPaths.filter((r) => r.dataUrl && !r.error);
      if (successful.length > 0) {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: batchLabel(prompts),
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
    const requestedPath = image.path;
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
      setImages((prev) =>
        prev.map((img, i) =>
          i === index ? { ...result, prompt, ...(requestedPath ? { path: requestedPath } : {}) } : img,
        ),
      );
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
