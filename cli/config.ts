import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function configPath(): string {
  return path.join(os.homedir(), ".openrouter-image-gen.json");
}

export function loadKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.apiKey ?? null;
  } catch {
    return null;
  }
}

export function saveKey(key: string): void {
  fs.writeFileSync(configPath(), JSON.stringify({ apiKey: key }, null, 2));
}
