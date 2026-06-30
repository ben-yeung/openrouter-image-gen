import {
  intro, outro, text, select, confirm, password, spinner, isCancel, cancel, note,
} from "@clack/prompts";
import clipboard from "clipboardy";
import { loadKey, saveKey, loadSplitModel, saveSplitModel } from "./config.js";
import { fetchImageModels, isValidSlugFormat, TOP_MODELS } from "../src/core/models.js";
import { generateVariations, generateBatch } from "../src/core/generate.js";
import { saveSession } from "../src/core/storage.js";
import { splitPrompts, batchLabel, type SplitItem } from "../src/core/split.js";

function bail<T>(value: T): asserts value is Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

async function ensureKey(): Promise<string> {
  const existing = loadKey();
  if (existing) return existing;
  const key = await password({ message: "OpenRouter API key:" });
  bail(key);
  if (!key) {
    cancel("API key cannot be empty.");
    process.exit(1);
  }
  const save = await confirm({ message: "Save this key for next time?" });
  bail(save);
  if (save) saveKey(key as string);
  return key as string;
}

async function generateFlow(apiKey: string) {
  const source = await select({
    message: "Prompt input:",
    options: [
      { value: "type", label: "Type a prompt" },
      { value: "clip", label: "Paste from clipboard" },
    ],
  });
  bail(source);

  let prompt: string;
  if (source === "clip") {
    prompt = (await clipboard.read()).trim();
    if (prompt) note(prompt, "Clipboard");
  } else {
    const typed = await text({ message: "Describe the image:" });
    bail(typed);
    prompt = (typed as string).trim();
  }
  if (!prompt) { note("Empty prompt — skipping.", "Skip"); return; }

  let items: SplitItem[] | null = null;
  const splitModel = loadSplitModel();
  const trySplit = await confirm({
    message: `Extract multiple prompts from this text using ${splitModel}?`,
    initialValue: false,
  });
  bail(trySplit);
  if (trySplit) {
    const ss = spinner();
    ss.start("Extracting prompts…");
    try {
      const extracted = await splitPrompts(prompt, { apiKey, model: splitModel });
      ss.stop(`Found ${extracted.length} prompt(s).`);
      note(
        extracted.map((it, i) => `${i + 1}. ${it.prompt}${it.path ? `  → ${it.path}` : ""}`).join("\n"),
        "Extracted prompts",
      );
      const ok = await confirm({
        message: `Generate these ${extracted.length} as separate images? (${extracted.length} requests)`,
      });
      bail(ok);
      if (ok) items = extracted;
    } catch (e) {
      ss.stop("Extraction failed.");
      note((e as Error).message, "Split failed");
    }
  }

  const models = await fetchImageModels().catch(() => TOP_MODELS);
  const model = await select({
    message: "Model:",
    options: [
      ...models.map((m) => ({ value: m.id, label: `${m.curated ? "★ " : ""}${m.name}` })),
      { value: "__custom__", label: "Custom slug…" },
    ],
  });
  bail(model);

  let modelId = model as string;
  if (modelId === "__custom__") {
    const slug = await text({
      message: "Custom model slug:",
      validate: (v) =>
        isValidSlugFormat(v.trim()) ? undefined : "Invalid model slug (expected author/model).",
    });
    bail(slug);
    modelId = (slug as string).trim();
  }

  if (items) {
    const prompts = items.map((it) => it.prompt);
    const s2 = spinner();
    s2.start(`Generating ${prompts.length} image(s)…`);
    const generated = await generateBatch(prompts, { apiKey, model: modelId });
    const withPaths = generated.map((img, i) => (items![i]?.path ? { ...img, path: items![i].path } : img));
    const ok = withPaths.filter((i) => i.dataUrl && !i.error);
    s2.stop(`Generated ${ok.length}/${prompts.length}.`);
    const failed = withPaths.filter((i) => i.error);
    if (failed.length) note(failed.map((f) => `#${f.index + 1}: ${f.error}`).join("\n"), "Errors");
    if (ok.length === 0) return;
    const { dir } = await saveSession({
      prompt: batchLabel(prompts),
      model: modelId,
      kind: "batch",
      images: withPaths,
    });
    note(dir, "Saved");
    return;
  }

  const countRaw = await text({ message: "Variations (1-8):", initialValue: "4" });
  bail(countRaw);
  const count = Math.min(8, Math.max(1, Number(countRaw) || 1));

  const s = spinner();
  s.start(`Generating ${count} image(s)…`);
  const images = await generateVariations({ apiKey, model: modelId, prompt }, count);
  const ok = images.filter((i) => i.dataUrl && !i.error);
  s.stop(`Generated ${ok.length}/${count}.`);

  const failed = images.filter((i) => i.error);
  if (failed.length) note(failed.map((f) => `#${f.index + 1}: ${f.error}`).join("\n"), "Errors");

  if (ok.length === 0) return;
  const { dir } = await saveSession({ prompt, model: modelId, images });
  note(dir, "Saved");
}

async function main() {
  intro("OpenRouter Image Gen");
  const apiKey = await ensureKey();

  for (;;) {
    const action = await select({
      message: "What now?",
      options: [
        { value: "gen", label: "Generate images" },
        { value: "splitmodel", label: "Change split model" },
        { value: "exit", label: "Exit" },
      ],
    });
    bail(action);
    if (action === "exit") break;
    if (action === "gen") await generateFlow(apiKey);
    if (action === "splitmodel") {
      note(loadSplitModel(), "Current split model");
      const newModel = await text({ message: "New split model slug (leave blank to keep current):" });
      bail(newModel);
      const trimmed = (newModel as string).trim();
      if (trimmed) {
        saveSplitModel(trimmed);
        note(trimmed, "Split model saved");
      }
    }
  }

  outro("Done.");
}

main();
