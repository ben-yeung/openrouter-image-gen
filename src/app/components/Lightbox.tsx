"use client";
import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { GeneratedImage } from "@/core";

export function Lightbox({
  images, index, onClose, onPrev, onNext,
}: {
  images: GeneratedImage[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const image = images[index];
  const many = images.length > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && many) onPrev();
      else if (e.key === "ArrowRight" && many) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, many]);

  if (!image) return null;
  const description = image.prompt ?? (image.seed !== undefined ? `Seed ${image.seed}` : null);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-neutral-300">
        <span className="text-xs tabular-nums text-neutral-500">
          {index + 1} / {images.length}
        </span>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Image area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4">
        {many && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            aria-label="Previous image"
            className="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-neutral-200 hover:bg-black/70"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.dataUrl}
          alt={image.prompt ?? `Generated image ${image.index + 1}`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[78vh] max-w-full rounded-lg object-contain"
        />
        {many && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            aria-label="Next image"
            className="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-neutral-200 hover:bg-black/70"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bottom description bar */}
      <div
        className="flex items-start justify-between gap-4 px-6 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="max-w-3xl text-sm text-neutral-300">
          {description ?? <span className="text-neutral-600">No description</span>}
        </p>
        <a
          href={image.dataUrl}
          download={`image-${image.index + 1}.png`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/10"
        >
          <Download className="h-3.5 w-3.5" /> Save
        </a>
      </div>
    </div>
  );
}
