"use client";
import { DownloadCloud } from "lucide-react";
import type { GeneratedImage } from "@/core";
import { ImageCard } from "./ImageCard";

export function Gallery({ images }: { images: GeneratedImage[] }) {
  const ok = images.filter((i) => i.dataUrl && !i.error);
  const downloadAll = () => {
    ok.forEach((img) => {
      const a = document.createElement("a");
      a.href = img.dataUrl;
      a.download = `image-${img.index + 1}.png`;
      a.click();
    });
  };
  return (
    <div className="space-y-3">
      {ok.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={downloadAll}
            className="flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
          >
            <DownloadCloud className="h-3.5 w-3.5" /> Download all
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((img) => (
          <ImageCard key={img.index} image={img} />
        ))}
      </div>
    </div>
  );
}
