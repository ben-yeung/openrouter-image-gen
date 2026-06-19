import { NextResponse } from "next/server";
import { saveSession } from "@/core/storage";
import type { GeneratedImage } from "@/core/types";

export const runtime = "nodejs";

interface SaveBody {
  prompt?: string;
  model?: string;
  kind?: "variations" | "batch";
  images?: GeneratedImage[];
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
