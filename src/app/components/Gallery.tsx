"use client";
import { useState } from "react";
import { DownloadCloud } from "lucide-react";
import { resolveImagePaths, type GeneratedImage } from "@/core";
import { ImageCard } from "./ImageCard";
import { Lightbox } from "./Lightbox";

export function Gallery({
  images,
  onReroll,
  rerolling,
}: {
  images: GeneratedImage[];
  onReroll?: (index: number) => void;
  rerolling?: Set<number>;
}) {
  const ok = images.filter((i) => i.dataUrl && !i.error);
  const [selected, setSelected] = useState<number | null>(null);

  // Resolve once across the whole successful batch so a name collision
  // (two rows sharing an output name) is disambiguated exactly the same way
  // it will be when the batch is actually saved to disk.
  const resolvedNames = resolveImagePaths(ok.map((img) => img.path));
  const outputNameByIndex = new Map(ok.map((img, i) => [img.index, resolvedNames[i]]));

  const downloadAll = () => {
    ok.forEach((img) => {
      const a = document.createElement("a");
      a.href = img.dataUrl;
      a.download = outputNameByIndex.get(img.index) || `image-${img.index + 1}.png`;
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
            outputName={outputNameByIndex.get(img.index)}
            onOpen={img.dataUrl && !img.error ? () => setSelected(ok.indexOf(img)) : undefined}
            onReroll={onReroll}
            rerolling={rerolling}
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
