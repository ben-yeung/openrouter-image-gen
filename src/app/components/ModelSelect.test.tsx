// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ModelSelect } from "./ModelSelect";

beforeEach(() => {
  // Default: catalog unavailable (offline) -> format-only validation path.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ModelSelect", () => {
  it("reveals a text field when Custom is selected", async () => {
    await act(async () => {
      render(<ModelSelect value="google/gemini-3.1-flash-image-preview" onChange={() => {}} />);
    });
    expect(screen.queryByPlaceholderText("author/model-slug")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    expect(screen.getByPlaceholderText("author/model-slug")).toBeTruthy();
  });

  it("commits a well-formed slug after the debounce when offline", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    await act(async () => {
      render(<ModelSelect value="google/gemini-3.1-flash-image-preview" onChange={onChange} />);
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    fireEvent.change(screen.getByPlaceholderText("author/model-slug"), {
      target: { value: "my/model" },
    });
    onChange.mockClear();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onChange).toHaveBeenCalledWith("my/model");
  });

  it("switches back to a named model and hides the custom field", async () => {
    const onChange = vi.fn();
    await act(async () => {
      render(<ModelSelect value="" onChange={onChange} />);
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    expect(screen.getByPlaceholderText("author/model-slug")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "google/gemini-3-pro-image-preview" },
    });
    expect(onChange).toHaveBeenCalledWith("google/gemini-3-pro-image-preview");
    expect(screen.queryByPlaceholderText("author/model-slug")).toBeNull();
  });
});
