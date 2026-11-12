import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAIAvailability, generateAISummary } from "./aiSuggestions";
import {
  ollamaRequest,
  parseOllamaResponse,
  SUMMARY_INSTRUCTION,
  validateSource,
} from "./aiProtocol";
import { sourceFingerprint, summarySource } from "./summarySource";
const source = {
  history:
    "Fictional right shoulder discomfort for six months. No prior surgery.",
  indication: "Overhead symptoms.",
  notes: "",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("local summary provider and protocol", () => {
  it("allows only source fields and creates a separated, non-streaming model request", () => {
    const widerContext = {
      ...source,
      caseIdentifier: "SECRET_ID",
      summary: "OLD_SUMMARY",
      findings: "SECRET_FINDINGS",
    };
    const picked = summarySource(widerContext);
    expect(Object.keys(picked)).toEqual(["history", "indication", "notes"]);
    const request = ollamaRequest(picked, "qwen2.5:1.5b");
    expect(request.stream).toBe(false);
    expect(request.options.temperature).toBe(0);
    expect(request.messages[0].content).toBe(SUMMARY_INSTRUCTION);
    expect(JSON.stringify(request)).not.toMatch(
      /SECRET_ID|OLD_SUMMARY|SECRET_FINDINGS/,
    );
    expect(request.messages[1].content).toContain("No prior surgery");
    expect(() => validateSource({ ...source, caseIdentifier: "no" })).toThrow(
      /only/,
    );
  });
  it("rejects empty and oversized input without making a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      generateAISummary({ history: " ", indication: "\n", notes: "" }),
    ).rejects.toThrow(/Enter/);
    await expect(
      generateAISummary({ ...source, notes: "x".repeat(6001) }),
    ).rejects.toThrow(/too long/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fingerprints the exact permitted context consistently", () => {
    expect(sourceFingerprint(source)).toMatch(/^[a-f0-9]{64}$/);
    expect(sourceFingerprint(source)).toBe(sourceFingerprint({ ...source }));
    expect(sourceFingerprint({ ...source, notes: "changed" })).not.toBe(
      sourceFingerprint(source),
    );
  });
  it("parses actual Ollama structured output and rejects missing, malformed or truncated output", () => {
    const valid = {
      model: "qwen2.5:1.5b",
      done: true,
      message: { content: '{"summary":"Fictional right shoulder symptoms."}' },
    };
    expect(parseOllamaResponse(valid).text).toBe(
      "Fictional right shoulder symptoms.",
    );
    for (const content of [
      "no json",
      '{"summary":""}',
      '{"summary":"x","extra":true}',
      JSON.stringify({ summary: "x".repeat(2001) }),
    ])
      expect(() =>
        parseOllamaResponse({ ...valid, message: { content } }),
      ).toThrow();
    expect(() => parseOllamaResponse({ ...valid, done: false })).toThrow(
      /finish/,
    );
    expect(() =>
      parseOllamaResponse({ ...valid, done_reason: "length" }),
    ).toThrow(/finish/);
  });
  it("posts only permitted input to the same-origin summary endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        text: "Draft summary",
        model: "qwen2.5:1.5b",
        generatedAt: "2026-11-12T12:00:00Z",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect((await generateAISummary(source)).text).toBe("Draft summary");
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("/api/ai/summary");
    expect(JSON.parse(options.body)).toEqual(source);
    expect(options.credentials).toBe("omit");
  });
  it("handles unavailable server, missing model, malformed responses and invalid metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(checkAIAvailability()).rejects.toThrow(/unavailable/);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Model not installed" }, { status: 404 }),
        ),
    );
    await expect(checkAIAvailability()).rejects.toThrow(/not installed/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad JSON")));
    await expect(generateAISummary(source)).rejects.toThrow(/invalid response/);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ text: "x", model: "qwen", generatedAt: "invalid" }),
        ),
    );
    await expect(generateAISummary(source)).rejects.toThrow(/malformed/);
  });
  it("cancels pending fetches and distinguishes a timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      ),
    );
    const controller = new AbortController();
    const request = generateAISummary(source, { signal: controller.signal });
    const assertion = expect(request).rejects.toThrow(/cancelled/);
    controller.abort();
    await assertion;
    const timed = generateAISummary(source, { timeoutMs: 20 });
    const timeoutAssertion = expect(timed).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(20);
    await timeoutAssertion;
  });
});
