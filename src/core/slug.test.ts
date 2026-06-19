import { describe, it, expect } from "vitest";
import { slugify, sessionFolderName, shortId } from "./slug";

describe("slugify", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugify("A Cat in Space!")).toBe("a-cat-in-space");
  });
  it("truncates to max length without trailing dash", () => {
    expect(slugify("x".repeat(100), 5)).toBe("xxxxx");
    expect(slugify("aa bb cc dd", 6)).toBe("aa-bb");
  });
  it("falls back to 'image' for empty input", () => {
    expect(slugify("!!!")).toBe("image");
  });
});

describe("shortId", () => {
  it("returns a 4-char lowercase alphanumeric id", () => {
    expect(shortId()).toMatch(/^[a-z0-9]{4}$/);
  });
});

describe("sessionFolderName", () => {
  it("formats as date_time__slug-id", () => {
    const d = new Date(2026, 5, 19, 14, 30, 0); // 2026-06-19 14:30:00 local
    expect(sessionFolderName("a cat", d, "x7k2")).toBe("2026-06-19_143000__a-cat-x7k2");
  });
});
