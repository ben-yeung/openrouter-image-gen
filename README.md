# OpenRouter Image Gen

Lightweight, BYOK pay-as-you-go image generation via OpenRouter — web app + interactive CLI sharing one core. Every generation is saved to `./generations/<session>/`.

## Setup
```bash
npm install
```

## Web
```bash
npm run dev      # http://localhost:3000
```
Enter your OpenRouter key (stored only in your browser), pick a model (or paste a custom slug), write a prompt, choose variations, Generate. Images render in the gallery and are written to `generations/`.

## CLI
```bash
npm run cli
```
Reads `OPENROUTER_API_KEY` (or prompts and optionally saves to `~/.openrouter-image-gen.json`). Menu-driven: prompt input (typed or from clipboard), model select, variation count.

## How it works
- BYOK: your key never goes to a shared server. The browser calls OpenRouter directly; a local API route only writes files.
- Each variation is one parallel request with a distinct seed (recorded in `metadata.json` for reproducibility).

## Test
```bash
npm test
```
