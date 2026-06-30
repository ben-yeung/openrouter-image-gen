import { describe, it, expect } from "vitest";
import { slugify, sessionFolderName, shortId, sanitizeImagePath, resolveImagePaths } from "./slug";

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

describe("sanitizeImagePath", () => {
  it("collapses a long multi-folder path to just the last folder + name.png", () => {
    expect(sanitizeImagePath("public/images/properties/villa/01.jpg")).toBe("villa/01.png");
  });

  it("keeps a single folder as-is, forcing a .png extension", () => {
    expect(sanitizeImagePath("villa/01.jpg")).toBe("villa/01.png");
  });

  it("uses just name.png when no folder is specified", () => {
    expect(sanitizeImagePath("01.jpg")).toBe("01.png");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(sanitizeImagePath("public\\images\\01.jpg")).toBe("images/01.png");
  });

  it("drops '..' traversal segments", () => {
    expect(sanitizeImagePath("../../etc/passwd")).toBe("etc/passwd.png");
  });

  it("replaces illegal filename characters", () => {
    expect(sanitizeImagePath('weird:name.jpg')).toBe("weird-name.png");
  });

  it("appends .png when the name has no extension", () => {
    expect(sanitizeImagePath("villa/cover")).toBe("villa/cover.png");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(sanitizeImagePath("../..")).toBe("");
  });
});

describe("resolveImagePaths", () => {
  it("collapses each path independently when there's no collision", () => {
    const result = resolveImagePaths([
      "public/images/properties/villa/01.jpg",
      "public/images/properties/villa/02.jpg",
    ]);
    expect(result).toEqual(["villa/01.png", "villa/02.png"]);
  });

  it("passes through undefined entries unchanged", () => {
    expect(resolveImagePaths(["villa/01.jpg", undefined])).toEqual(["villa/01.png", undefined]);
  });

  it("keeps an extra folder level for entries that would otherwise collide", () => {
    const result = resolveImagePaths(["site-a/villa/01.jpg", "site-b/villa/01.jpg"]);
    expect(result).toEqual(["site-a/villa/01.png", "site-b/villa/01.png"]);
  });

  it("only extends depth for entries that actually still collide", () => {
    // "a/x/villa/01" and "b/x/villa/01" collide all the way to "x/villa/01"
    // and need one more level each; "c/y/villa/01" is already unique at
    // "y/villa/01" and doesn't need to grow any further.
    const result = resolveImagePaths([
      "a/x/villa/01.jpg",
      "b/x/villa/01.jpg",
      "c/y/villa/01.jpg",
    ]);
    expect(result).toEqual(["a/x/villa/01.png", "b/x/villa/01.png", "y/villa/01.png"]);
  });

  it("appends a numeric suffix when paths are identical even at full depth", () => {
    const result = resolveImagePaths(["villa/01.jpg", "villa/01.jpg"]);
    expect(result).toEqual(["villa/01.png", "villa/01-2.png"]);
  });

  it("doesn't disambiguate against unrelated paths without a path", () => {
    const result = resolveImagePaths([undefined, "villa/01.jpg", undefined]);
    expect(result).toEqual([undefined, "villa/01.png", undefined]);
  });
});
