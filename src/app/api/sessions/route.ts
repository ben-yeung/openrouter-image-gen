import { NextResponse } from "next/server";
import { saveSession } from "@/core/storage";
import type { GeneratedImage } from "@/core/types";

export const runtime = "nodejs";

interface SaveBody {
  prompt?: string;
  model?: string;
  images?: GeneratedImage[];
}

export async function POST(req: Request) {
  try {
    const { prompt, model, images } = (await req.json()) as SaveBody;
    if (!prompt || !model || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "prompt, model and images are required" },
        { status: 400 },
      );
    }
    const { dir, session } = await saveSession({ prompt, model, images });
    return NextResponse.json({ dir, session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
