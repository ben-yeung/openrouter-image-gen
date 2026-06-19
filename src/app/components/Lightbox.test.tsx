// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Lightbox } from "./Lightbox";
import type { GeneratedImage } from "@/core";

const img = (i: number, extra: Partial<GeneratedImage> = {}): GeneratedImage => ({
  index: i,
  dataUrl: `data:image/png;base64,AAA${i}`,
  seed: 100 + i,
  ...extra,
});

const three = [
  img(0, { prompt: "a cat in space" }),
  img(1, { prompt: "a dog on the moon" }),
  img(2),
];

describe("Lightbox", () => {
  it("shows the current image, its description, and the position counter", () => {
    render(<Lightbox images={three} index={0} onClose={() => {}} onPrev={() => {}} onNext={() => {}} />);
    const image = screen.getByRole("img");
    expect(image.getAttribute("src")).toBe("data:image/png;base64,AAA0");
    expect(screen.getByText("a cat in space")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("falls back to the seed when there is no prompt", () => {
    render(<Lightbox images={three} index={2} onClose={() => {}} onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByText("Seed 102")).toBeTruthy();
  });

  it("fires onNext and onPrev from the arrow buttons", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(<Lightbox images={three} index={1} onClose={() => {}} onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(screen.getByLabelText("Next image"));
    fireEvent.click(screen.getByLabelText("Previous image"));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("handles keyboard: Escape closes, arrows navigate", () => {
    const onClose = vi.fn();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(<Lightbox images={three} index={1} onClose={onClose} onPrev={onPrev} onNext={onNext} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the arrows when there is only one image", () => {
    render(<Lightbox images={[img(0)]} index={0} onClose={() => {}} onPrev={() => {}} onNext={() => {}} />);
    expect(screen.queryByLabelText("Next image")).toBeNull();
    expect(screen.queryByLabelText("Previous image")).toBeNull();
  });
});
