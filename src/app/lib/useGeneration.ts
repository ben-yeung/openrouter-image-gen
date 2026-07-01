"use client";
import { useRef, useState } from "react";
import { generateVariations, generateBatch, generateImage, batchLabel, resolveImagePaths, type GeneratedImage, type SplitItem } from "@/core";

type SessionKind = "variations" | "batch";

interface LastParams {
  apiKey: string;
  model: string;
  prompt: string; // fallback prompt for rerolling a slot that carries none
  kind: SessionKind;
  label: string; // the session's display prompt (batch label for batches)
}

export function useGeneration() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedDir, setSavedDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastParams, setLastParams] = useState<LastParams | null>(null);
  const [rerolling, setRerolling] = useState<Set<number>>(new Set());
  // Mirror savedDir synchronously so a reroll started before a React re-render
  // still sees the current session, and serialize first-time creation so
  // retrying several failed slots at once can't spawn duplicate folders.
  const savedDirRef = useRef<string | null>(null);
  const creatingSessionRef = useRef<Promise<string | null> | null>(null);

  function rememberSavedDir(dir: string | null) {
    savedDirRef.current = dir;
    setSavedDir(dir);
  }

  function resetSession() {
    creatingSessionRef.current = null;
    rememberSavedDir(null);
  }

  async function postSession(body: {
    prompt: string;
    model: string;
    kind: SessionKind;
    images: GeneratedImage[];
  }): Promise<string | null> {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.dir ?? null;
  }

  // Returns the current session folder, creating one from `successful` if the
  // run never saved (e.g. every image failed and was then retried). Concurrent
  // callers share a single in-flight creation.
  async function ensureSessionDir(successful: GeneratedImage[]): Promise<string | null> {
    if (savedDirRef.current) return savedDirRef.current;
    if (!lastParams) return null;
    if (!creatingSessionRef.current) {
      creatingSessionRef.current = postSession({
        prompt: lastParams.label,
        model: lastParams.model,
        kind: lastParams.kind,
        images: successful,
      }).then((dir) => {
        if (dir) rememberSavedDir(dir);
        else creatingSessionRef.current = null; // allow a later reroll to retry
        return dir;
      });
    }
    return creatingSessionRef.current;
  }

  async function run(args: { apiKey: string; model: string; prompt: string; count: number }) {
    setLastParams({ apiKey: args.apiKey, model: args.model, prompt: args.prompt, kind: "variations", label: args.prompt });
    setLoading(true);
    setError(null);
    resetSession();
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
        const dir = await postSession({ prompt: args.prompt, model: args.model, kind: "variations", images: successful });
        if (dir) rememberSavedDir(dir);
        else setError("Images generated but could not be saved to disk.");
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
    setLastParams({ apiKey: args.apiKey, model: args.model, prompt: prompts[0] ?? "", kind: "batch", label: batchLabel(prompts) });
    setLoading(true);
    setError(null);
    resetSession();
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
        const dir = await postSession({ prompt: batchLabel(prompts), model: args.model, kind: "batch", images: successful });
        if (dir) rememberSavedDir(dir);
        else setError("Images generated but could not be saved to disk.");
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
      const updated = { ...result, prompt, ...(requestedPath ? { path: requestedPath } : {}) };
      setImages((prev) => prev.map((img, i) => (i === index ? updated : img)));

      // Persist the new image so a reroll/retry actually lands on disk, at the
      // same output name the batch save would resolve for it. Create the session
      // folder if the original run saved nothing (e.g. every image failed and was
      // then retried); otherwise append/replace into the existing one.
      if (updated.dataUrl && !updated.error) {
        const next = images.map((img, i) => (i === index ? updated : img));
        const successful = next.filter((img) => img.dataUrl && !img.error);
        const resolved = resolveImagePaths(successful.map((img) => img.path));
        const pos = successful.findIndex((img) => img.index === index);
        const file = resolved[pos] || `${String(pos + 1).padStart(2, "0")}.png`;
        try {
          const dir = await ensureSessionDir(successful);
          if (dir) {
            await fetch("/api/sessions", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dir,
                file,
                image: { index, dataUrl: updated.dataUrl, seed: updated.seed, prompt: updated.prompt },
              }),
            });
          }
        } catch {
          // Best-effort persistence; the image is already shown and downloadable.
        }
      }
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
