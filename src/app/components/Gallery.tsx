"use client";
import { useState } from "react";
import { DownloadCloud } from "lucide-react";
import type { GeneratedImage } from "@/core";
import { ImageCard } from "./ImageCard";
import { Lightbox } from "./Lightbox";

export function Gallery({ images }: { images: GeneratedImage[] }) {
  const ok = images.filter((i) => i.dataUrl && !i.error);
  const [selected, setSelected] = useState<number | null>(null);

  const downloadAll = () => {
    ok.forEach((img) => {
      const a = document.createElement("a");
      a.href = img.dataUrl;
      a.download = `image-${img.index + 1}.png`;
      a.click();
    });
  };

  const step = (delta: number) =>
    setSelected((i) => (i === null ? i : (i + delta + ok.length) % ok.length));

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
          <ImageCard
            key={img.index}
            image={img}
            onOpen={img.dataUrl && !img.error ? () => setSelected(ok.indexOf(img)) : undefined}
          />
        ))}
      </div>

      {selected !== null && ok[selected] && (
        <Lightbox
          images={ok}
          index={selected}
          onClose={() => setSelected(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </div>
  );
}
