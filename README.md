# OpenRouter Image Gen

Lightweight, BYOK pay-as-you-go image generation via OpenRouter — web app + interactive CLI sharing one core. Every generation is saved to `./generations/<session>/` with a `metadata.json`.

## Setup
```bash
npm install
```

## Web
```bash
npm run dev      # http://localhost:3000
```
Enter your OpenRouter key (stored only in your browser), pick a model, write a prompt, choose variations, Generate. Images render in the gallery and are written to `generations/`.

## CLI
```bash
npm run cli
```
Reads `OPENROUTER_API_KEY` (or prompts and optionally saves to `~/.openrouter-image-gen.json`). Menu-driven: prompt input (typed or from clipboard), optional prompt splitting, model select, variation count.

## Features
- **Model picker** — choose from a curated list (★) of image models, or paste a **custom model slug** (`author/model`) to use anything OpenRouter offers.
- **Variations** — generate N images (1–8) for a prompt, each a parallel request with a distinct seed recorded in `metadata.json` for reproducibility.
- **Split prompts** — paste free-form text describing several images and a cheap text model extracts the distinct prompts. Review and edit the list, then generate them as a batch. The split model is configurable (in Settings on web, "Change split model" in the CLI).

## How it works
- BYOK: your key never goes to a shared server. The browser calls OpenRouter directly; a local API route only writes files.
- Each variation or split prompt is one independent request, so partial failures don't block the rest.

## License
[MIT](LICENSE)
