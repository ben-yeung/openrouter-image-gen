import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SPLIT_MODEL } from "../src/core/types.js";

interface CliConfig {
  apiKey?: string;
  splitModel?: string;
}

export function configPath(): string {
  return path.join(os.homedir(), ".openrouter-image-gen.json");
}

function readConfig(): CliConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

function writeConfig(next: CliConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
}

export function loadKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  return readConfig().apiKey ?? null;
}

export function saveKey(key: string): void {
  writeConfig({ ...readConfig(), apiKey: key });
}

export function loadSplitModel(): string {
  return readConfig().splitModel ?? DEFAULT_SPLIT_MODEL;
}

export function saveSplitModel(model: string): void {
  writeConfig({ ...readConfig(), splitModel: model });
}
