import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
beforeEach(async () => {
  vi.resetModules();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "imggen-route-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("POST /api/sessions", () => {
  it("saves images and returns the session", async () => {
    const { POST } = await import("./route");
    const b64 = Buffer.from("img").toString("base64");
    const req = new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        prompt: "a cat",
        model: "m",
        images: [{ index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1 }],
      }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.count).toBe(1);
    expect(json.dir).toContain(path.join(root, "generations"));
  });

  it("returns 400 when prompt or images are missing", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ model: "m" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it("saves a batch with per-image prompts", async () => {
    const { POST } = await import("./route");
    const b64 = Buffer.from("img").toString("base64");
    const req = new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        prompt: "a cat +1 more",
        model: "m",
        kind: "batch",
        images: [
          { index: 0, dataUrl: `data:image/png;base64,${b64}`, seed: 1, prompt: "a cat" },
          { index: 1, dataUrl: `data:image/png;base64,${b64}`, seed: 2, prompt: "a dog" },
        ],
      }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.kind).toBe("batch");
    expect(json.session.images[1].prompt).toBe("a dog");
  });
});
