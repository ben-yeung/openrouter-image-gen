"use client";
import { useState } from "react";
import { generateVariations, type GeneratedImage } from "@/core";

export function useGeneration() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedDir, setSavedDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(args: { apiKey: string; model: string; prompt: string; count: number }) {
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

  return { images, loading, savedDir, error, run };
}
