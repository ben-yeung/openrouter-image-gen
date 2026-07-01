import { NextResponse } from "next/server";
import { saveSession, saveSessionImage } from "@/core/storage";
import type { GeneratedImage } from "@/core/types";

export const runtime = "nodejs";

interface SaveBody {
  prompt?: string;
  model?: string;
  kind?: "variations" | "batch";
  images?: GeneratedImage[];
}

interface PatchBody {
  dir?: string;
  file?: string;
  image?: GeneratedImage;
}

// Local-tool assumption: this unauthenticated endpoint writes generated images
// to ./generations on the dev server's filesystem. It is safe only because the
// app runs locally (next dev binds localhost). Do NOT expose this server publicly.
export async function POST(req: Request) {
  try {
    const { prompt, model, kind, images } = (await req.json()) as SaveBody;
    if (!prompt || !model || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "prompt, model and images are required" },
        { status: 400 },
      );
    }
    const { dir, session } = await saveSession({ prompt, model, kind, images });
    return NextResponse.json({ dir, session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Writes a single rerolled/retried image into an existing session folder so
// the new image lands on disk at its resolved output name.
export async function PATCH(req: Request) {
  try {
    const { dir, file, image } = (await req.json()) as PatchBody;
    if (!dir || !file || !image?.dataUrl) {
      return NextResponse.json(
        { error: "dir, file and image are required" },
        { status: 400 },
      );
    }
    const result = await saveSessionImage({ dir, file, image });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
