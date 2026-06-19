// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SplitConfirmModal } from "./SplitConfirmModal";

describe("SplitConfirmModal", () => {
  it("shows the split model name", () => {
    render(
      <SplitConfirmModal model="google/gemini-3.1-flash" loading={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText("google/gemini-3.1-flash")).toBeTruthy();
  });

  it("fires onConfirm and onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<SplitConfirmModal model="m" loading={false} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Extract prompts"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both actions while loading", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<SplitConfirmModal model="m" loading={true} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText("Extracting…")).toBeTruthy();
  });
});
