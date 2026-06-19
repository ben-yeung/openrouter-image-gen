import { promises as fs } from "node:fs";
import path from "node:path";
import { sessionFolderName, shortId } from "./slug";
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
  const images: Session["images"] = [];
  let n = 1;
  for (const img of successful) {
    const file = `${String(n).padStart(2, "0")}.png`;
    // All dataUrls produced by generate.ts are base64-encoded PNG data URLs.
    const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    await fs.writeFile(path.join(dir, file), Buffer.from(base64, "base64"));
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
