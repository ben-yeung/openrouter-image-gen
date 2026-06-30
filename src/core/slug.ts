import { customAlphabet } from "nanoid";

export const shortId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4);

export function slugify(prompt: string, max = 40): string {
  const s = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = (s || "image").slice(0, max).replace(/-+$/g, "");
  return truncated || "image";
}

export function sessionFolderName(prompt: string, date = new Date(), id = shortId()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}__${slugify(prompt)}-${id}`;
}

const ILLEGAL_FILENAME_CHARS = /[<>:"|?*\x00-\x1f]/g;

/**
 * Splits a user-supplied output path into sanitized segments: illegal
 * filename characters are replaced, ".." traversal segments are dropped, and
 * the final segment's extension is forced to ".png" (that's what
 * generate.ts actually writes, regardless of what extension was requested).
 * Returns [] if nothing usable remains.
 */
function sanitizeSegments(input: string): string[] {
  const segments = input
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.replace(ILLEGAL_FILENAME_CHARS, "-").trim().replace(/[. ]+$/, ""))
    .filter((s) => s && s !== "." && s !== "..");
  if (segments.length === 0) return [];

  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf(".");
  const stem = (dot > 0 ? last.slice(0, dot) : last) || "image";
  segments[segments.length - 1] = `${stem}.png`;
  return segments;
}

/**
 * Turns a user-supplied output path (e.g. "public/images/villa/01.jpg") into
 * a safe relative path of at most one folder deep: only the immediate parent
 * folder is kept (a longer path like "public/images/villa/01.jpg" collapses
 * to "villa/01.png"; a bare "01.jpg" stays "01.png"). See sanitizeSegments
 * for the underlying cleanup rules. Returns "" if nothing usable remains.
 */
export function sanitizeImagePath(input: string): string {
  const segments = sanitizeSegments(input);
  return segments.slice(-2).join("/");
}

/**
 * Resolves the final output name for each path in a batch. Each path
 * collapses to <lastFolder>/name.png by default (see sanitizeImagePath), but
 * when two or more items would collapse to the same name, those colliding
 * items keep one additional folder level — repeated until they're unique or
 * the original path is exhausted — so distinct sources never overwrite each
 * other. Entries without a path (undefined) are passed through unchanged.
 */
export function resolveImagePaths(paths: (string | undefined)[]): (string | undefined)[] {
  const segments = paths.map((p) => (p ? sanitizeSegments(p) : null));
  const depths = segments.map((s) => (s ? Math.min(2, s.length) : 0));

  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Map<string, number[]>();
    segments.forEach((s, i) => {
      if (!s) return;
      const candidate = s.slice(-depths[i]).join("/");
      const idxs = groups.get(candidate) ?? [];
      idxs.push(i);
      groups.set(candidate, idxs);
    });
    for (const idxs of groups.values()) {
      if (idxs.length <= 1) continue;
      for (const i of idxs) {
        const s = segments[i]!;
        if (depths[i] < s.length) {
          depths[i]++;
          changed = true;
        }
      }
    }
  }

  // Final guard: paths identical even at full depth (the model inferred the
  // same name for two distinct prompts) still collide — disambiguate with a
  // numeric suffix rather than silently overwrite one of them.
  const seen = new Map<string, number>();
  return segments.map((s, i) => {
    if (!s) return undefined;
    let candidate = s.slice(-depths[i]).join("/");
    const count = (seen.get(candidate) ?? 0) + 1;
    seen.set(candidate, count);
    if (count > 1) {
      const dot = candidate.lastIndexOf(".");
      const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
      const ext = dot > 0 ? candidate.slice(dot) : "";
      candidate = `${stem}-${count}${ext}`;
    }
    return candidate;
  });
}
