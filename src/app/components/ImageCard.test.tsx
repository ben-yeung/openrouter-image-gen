// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageCard } from "./ImageCard";
import type { GeneratedImage } from "@/core";

const img = (i: number, extra: Partial<GeneratedImage> = {}): GeneratedImage => ({
  index: i,
  dataUrl: `data:image/png;base64,AAA${i}`,
  seed: 100 + i,
  ...extra,
});

describe("ImageCard reroll", () => {
  it("renders a reroll button when onReroll is provided", () => {
    render(<ImageCard image={img(0)} onReroll={vi.fn()} rerolling={new Set()} />);
    expect(screen.getByLabelText("Reroll image 1")).toBeTruthy();
  });

  it("does not render a reroll button when onReroll is not provided", () => {
    render(<ImageCard image={img(0)} rerolling={new Set()} />);
    expect(screen.queryByLabelText("Reroll image 1")).toBeNull();
  });

  it("calls onReroll with the correct image index when clicked", () => {
    const onReroll = vi.fn();
    render(<ImageCard image={img(2)} onReroll={onReroll} rerolling={new Set()} />);
    fireEvent.click(screen.getByLabelText("Reroll image 3"));
    expect(onReroll).toHaveBeenCalledWith(2);
    expect(onReroll).toHaveBeenCalledTimes(1);
  });

  it("disables the reroll button when this card's index is in rerolling", () => {
    render(<ImageCard image={img(0)} onReroll={vi.fn()} rerolling={new Set([0])} />);
    const btn = screen.getByLabelText("Reroll image 1") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("does not disable the reroll button when a different card is rerolling", () => {
    render(<ImageCard image={img(0)} onReroll={vi.fn()} rerolling={new Set([1])} />);
    const btn = screen.getByLabelText("Reroll image 1") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("does not render a reroll button for error cards", () => {
    render(
      <ImageCard
        image={{ index: 0, dataUrl: "", error: "Request failed (500)" }}
        onReroll={vi.fn()}
        rerolling={new Set()}
      />,
    );
    expect(screen.queryByLabelText("Reroll image 1")).toBeNull();
  });
});

describe("ImageCard output name", () => {
  it("shows the given output name", () => {
    render(<ImageCard image={img(0)} outputName="villa/01.png" rerolling={new Set()} />);
    expect(screen.getByText("villa/01.png")).toBeTruthy();
  });

  it("uses the output name as the download filename", () => {
    render(<ImageCard image={img(0)} outputName="villa/01.png" rerolling={new Set()} />);
    const link = screen.getByText("Save").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe("villa/01.png");
  });

  it("falls back to the generic filename when no output name is given", () => {
    render(<ImageCard image={img(0)} rerolling={new Set()} />);
    const link = screen.getByText("Save").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe("image-1.png");
  });
});
