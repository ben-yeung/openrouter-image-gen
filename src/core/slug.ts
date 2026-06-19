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
