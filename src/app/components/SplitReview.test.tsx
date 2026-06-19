// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SplitReview } from "./SplitReview";

describe("SplitReview", () => {
  it("shows the request count and highlights large batches", () => {
    const prompts = Array.from({ length: 12 }, (_, i) => `prompt ${i}`);
    render(<SplitReview prompts={prompts} onChange={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    const count = screen.getByTestId("request-count");
    expect(count.textContent).toContain("12");
    expect(count.className).toContain("text-red");
  });

  it("does not highlight small batches", () => {
    render(<SplitReview prompts={["a", "b"]} onChange={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("request-count").className).not.toContain("text-red");
  });

  it("removes a row", () => {
    const onChange = vi.fn();
    render(<SplitReview prompts={["a", "b"]} onChange={onChange} onConfirm={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getAllByLabelText("Remove prompt")[0]);
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("confirms with the current prompts", () => {
    const onConfirm = vi.fn();
    render(<SplitReview prompts={["a", "b"]} onChange={() => {}} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText(/Generate 2/));
    expect(onConfirm).toHaveBeenCalled();
  });
});
