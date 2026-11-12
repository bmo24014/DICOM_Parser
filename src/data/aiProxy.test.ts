import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  localAIProxy,
  validateOllamaTarget,
  validateModel,
} from "../../server/aiProxy";

let upstream: Server, bridge: Server, base: string;
let requests: { url: string; body: string }[] = [];
let mode = "good";
const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url!, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags")
      res.end(
        JSON.stringify({
          models:
            mode === "missing"
              ? []
              : [
                  {
                    name: "qwen2.5:1.5b",
                    ...(mode === "cloud" ? { remote_host: "remote" } : {}),
                  },
                ],
        }),
      );
    else if (req.url === "/api/chat")
      res.end(
        JSON.stringify({
          done: true,
          model: "qwen2.5:1.5b",
          message: {
            content:
              mode === "malformed"
                ? "bad"
                : '{"summary":"Fictional draft from stub upstream."}',
          },
        }),
      );
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  const url = await listen(upstream);
  let handler: ((...args: unknown[]) => unknown) | undefined;
  const plugin = localAIProxy(url);
  (plugin.configureServer as (server: unknown) => void)({
    middlewares: {
      use: (value: typeof handler) => {
        handler = value;
      },
    },
  });
  bridge = createServer((req, res) => {
    void handler!(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  base = await listen(bridge);
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((r) => bridge.close(() => r())),
    new Promise<void>((r) => upstream.close(() => r())),
  ]);
});
describe("narrow local AI bridge (stub upstream, not model inference)", () => {
  it("rejects external targets, credentialed URLs, paths and cloud configurations", () => {
    for (const value of [
      "https://example.com",
      "http://127.0.0.1.evil.test",
      "http://user:pass@localhost:11434",
      "http://localhost:11434/path",
      "ftp://localhost",
    ])
      expect(() => validateOllamaTarget(value)).toThrow();
    expect(validateOllamaTarget("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434",
    );
    expect(() => validateModel("gpt-oss:120b-cloud")).toThrow();
  });
  it("forwards only a validated source payload and fixed configured model to local inference", async () => {
    mode = "good";
    requests = [];
    expect((await fetch(`${base}/api/ai/status`)).status).toBe(200);
    const response = await fetch(`${base}/api/ai/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history: "Fictional history",
        indication: "",
        notes: "",
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).text).toContain("stub upstream");
    const body = JSON.parse(
      requests.find((value) => value.url === "/api/chat")!.body,
    );
    expect(body.model).toBe("qwen2.5:1.5b");
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
  });
  it("does not expose other Ollama routes, methods, or cross-origin requests", async () => {
    requests = [];
    for (const path of [
      "/api/ai/pull",
      "/api/ai/summary?forward=remote",
      "/api/ai/status/extra",
    ])
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/ai/status`, { method: "POST" })).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${base}/api/ai/status`, {
          headers: { Origin: "https://external.example" },
        })
      ).status,
    ).toBe(403);
    expect(requests).toEqual([]);
  });
  it("rejects extra source fields and missing/cloud models; handles malformed upstream output", async () => {
    const post = (body: unknown) =>
      fetch(`${base}/api/ai/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    mode = "good";
    requests = [];
    expect(
      (
        await post({
          history: "x",
          indication: "",
          notes: "",
          model: "remote",
          caseIdentifier: "secret",
        })
      ).status,
    ).toBe(400);
    expect(requests).toEqual([]);
    mode = "missing";
    expect((await fetch(`${base}/api/ai/status`)).status).toBe(404);
    mode = "cloud";
    expect((await fetch(`${base}/api/ai/status`)).status).toBe(400);
    mode = "malformed";
    expect(
      (await post({ history: "x", indication: "", notes: "" })).status,
    ).toBe(502);
    mode = "good";
  });
});
