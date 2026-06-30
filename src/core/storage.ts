import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveImagePaths, sessionFolderName, shortId } from "./slug";
import type { GeneratedImage, Session } from "./types";

export async function saveSession(input: {
  prompt: string;
  model: string;
  images: GeneratedImage[];
  kind?: "variations" | "batch";
  rootDir?: string;
  now?: Date;
}): Promise<{ dir: string; session: Session }> {
  const id = shortId();
  const now = input.now ?? new Date();
  const root = input.rootDir ?? path.resolve(process.cwd(), "generations");
  const dir = path.join(root, sessionFolderName(input.prompt, now, id));
  await fs.mkdir(dir, { recursive: true });

  const successful = input.images.filter((img) => img.dataUrl && !img.error);
  // A requested output path (from structured split input) keeps its own
  // folder structure and name, resolved together across the batch so
  // colliding names don't overwrite each other; otherwise fall back to
  // sequential NN.png.
  const resolved = resolveImagePaths(successful.map((img) => img.path));
  const images: Session["images"] = [];
  let n = 1;
  for (const [i, img] of successful.entries()) {
    const file = resolved[i] || `${String(n).padStart(2, "0")}.png`;
    const dest = path.join(dir, file);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // All dataUrls produced by generate.ts are base64-encoded PNG data URLs.
    const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    await fs.writeFile(dest, Buffer.from(base64, "base64"));
    images.push({ file, seed: img.seed, ...(img.prompt ? { prompt: img.prompt } : {}) });
    n++;
  }

  const session: Session = {
    sessionId: id,
    prompt: input.prompt,
    model: input.model,
    count: images.length,
    createdAt: now.toISOString(),
    kind: input.kind ?? "variations",
    images,
  };
  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(session, null, 2));
  return { dir, session };
}
