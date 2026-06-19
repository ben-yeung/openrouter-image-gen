// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useApiKey } from "./useApiKey";

beforeEach(() => localStorage.clear());

describe("useApiKey", () => {
  it("persists the key to localStorage and reads it back", () => {
    const { result } = renderHook(() => useApiKey());
    expect(result.current.apiKey).toBe("");
    act(() => result.current.setApiKey("sk-test"));
    expect(result.current.apiKey).toBe("sk-test");
    expect(localStorage.getItem("openrouter_api_key")).toBe("sk-test");
  });

  it("clears the key", () => {
    const { result } = renderHook(() => useApiKey());
    act(() => result.current.setApiKey("sk-test"));
    act(() => result.current.clear());
    expect(result.current.apiKey).toBe("");
    expect(localStorage.getItem("openrouter_api_key")).toBeNull();
  });
});
