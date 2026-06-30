"use client";
import { Download, ImageOff, RefreshCw, Loader2 } from "lucide-react";
import type { GeneratedImage } from "@/core";

export function ImageCard({
  image,
  outputName,
  onOpen,
  onReroll,
  rerolling = new Set(),
}: {
  image: GeneratedImage;
  outputName?: string;
  onOpen?: () => void;
  onReroll?: (index: number) => void;
  rerolling?: Set<number>;
}) {
  if (image.error || !image.dataUrl) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-center text-xs text-neutral-500">
        <ImageOff className="h-5 w-5" />
        <span>{image.error ?? "Failed"}</span>
      </div>
    );
  }

  const isRerolling = rerolling.has(image.index);

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
          <img
            src={image.dataUrl}
            alt={`Generated image ${image.index + 1}`}
            className={`aspect-square w-full object-cover transition-opacity${isRerolling ? " opacity-50" : ""}`}
          />
        </button>
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          {onReroll && (
            <button
              type="button"
              onClick={() => onReroll(image.index)}
              disabled={isRerolling}
              aria-label={`Reroll image ${image.index + 1}`}
              className="flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs disabled:cursor-not-allowed"
            >
              {isRerolling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}{" "}
              Reroll
            </button>
          )}
          <a
            href={image.dataUrl}
            download={outputName || `image-${image.index + 1}.png`}
            className="flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs"
          >
            <Download className="h-3.5 w-3.5" /> Save
          </a>
        </div>
      </div>
      {(outputName || image.prompt) && (
        <div className="px-2 py-1.5">
          {outputName && <p className="truncate text-xs font-medium text-neutral-300">{outputName}</p>}
          {image.prompt && <p className="line-clamp-2 text-xs text-neutral-400">{image.prompt}</p>}
        </div>
      )}
    </div>
  );
}
