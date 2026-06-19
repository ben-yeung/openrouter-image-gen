"use client";
import { Download, ImageOff } from "lucide-react";
import type { GeneratedImage } from "@/core";

export function ImageCard({ image, onOpen }: { image: GeneratedImage; onOpen?: () => void }) {
  if (image.error || !image.dataUrl) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-center text-xs text-neutral-500">
        <ImageOff className="h-5 w-5" />
        <span>{image.error ?? "Failed"}</span>
      </div>
    );
  }
  return (
    <div className="group overflow-hidden rounded-xl border border-neutral-800">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`View generated image ${image.index + 1}`}
          className="block w-full cursor-zoom-in"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.dataUrl} alt={`Generated image ${image.index + 1}`} className="aspect-square w-full object-cover" />
        </button>
        <a
          href={image.dataUrl}
          download={`image-${image.index + 1}.png`}
          className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs opacity-0 transition group-hover:opacity-100"
        >
          <Download className="h-3.5 w-3.5" /> Save
        </a>
      </div>
      {image.prompt && (
        <p className="line-clamp-2 px-2 py-1.5 text-xs text-neutral-400">{image.prompt}</p>
      )}
    </div>
  );
}
