// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettings } from "./useSettings";
import { DEFAULT_SPLIT_MODEL } from "@/core";

beforeEach(() => localStorage.clear());

describe("useSettings", () => {
  it("defaults the split model to DEFAULT_SPLIT_MODEL", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.splitModel).toBe(DEFAULT_SPLIT_MODEL);
  });

  it("persists a custom split model", () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.setSplitModel("openai/gpt-5-mini"));
    expect(result.current.splitModel).toBe("openai/gpt-5-mini");
    expect(localStorage.getItem("openrouter_split_model")).toBe("openai/gpt-5-mini");
  });
});
