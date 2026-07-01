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

/**
 * Writes a single (re)generated image into an existing session folder at a
 * caller-resolved file name, and updates metadata.json to match — replacing
 * the entry if that file already exists, or appending it if it's new (e.g. a
 * previously-failed slot that was retried). Used by reroll/retry so the new
 * image actually lands on disk instead of only in the browser.
 *
 * `dir` and `file` are validated to stay inside the generations root so the
 * unauthenticated local endpoint can't be coaxed into writing elsewhere.
 */
export async function saveSessionImage(input: {
  dir: string;
  file: string;
  image: GeneratedImage;
  rootDir?: string;
}): Promise<{ dir: string; file: string }> {
  const root = input.rootDir ?? path.resolve(process.cwd(), "generations");
  const dir = path.resolve(input.dir);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error("Refusing to write outside the generations directory");
  }
  const dest = path.resolve(dir, input.file);
  if (dest !== dir && !dest.startsWith(dir + path.sep)) {
    throw new Error("Refusing to write outside the session directory");
  }

  await fs.mkdir(path.dirname(dest), { recursive: true });
  const base64 = input.image.dataUrl.replace(/^data:image\/\w+;base64,/, "");
  await fs.writeFile(dest, Buffer.from(base64, "base64"));

  // Keep metadata.json in sync when it exists; the image file itself is the
  // source of truth, so a missing/unreadable metadata file is non-fatal.
  const metaPath = path.join(dir, "metadata.json");
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Session;
    const entry = {
      file: input.file,
      seed: input.image.seed,
      ...(input.image.prompt ? { prompt: input.image.prompt } : {}),
    };
    const at = meta.images.findIndex((im) => im.file === input.file);
    if (at >= 0) meta.images[at] = entry;
    else meta.images.push(entry);
    meta.count = meta.images.length;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // No metadata to update — leave the written image in place.
  }

  return { dir, file: input.file };
}
