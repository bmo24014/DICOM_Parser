import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  DEFAULT_AI_MODEL,
  AI_TIMEOUT_MS,
  validateSource,
  ollamaRequest,
  parseOllamaResponse,
} from "../src/data/aiProtocol";

export function validateOllamaTarget(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "OLLAMA_BASE_URL must be a loopback HTTP(S) origin with no credentials, path, or query.",
    );
  return url.origin;
}
export function validateModel(value: string): string {
  if (
    !/^[a-zA-Z0-9._:/-]{1,200}$/.test(value) ||
    /cloud/i.test(value) ||
    value.includes("://")
  )
    throw new Error(
      "OLLAMA_MODEL must name a locally installed model, not a cloud model or URL.",
    );
  return value;
}
class AIError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.ok)
    throw new AIError(
      response.status === 404
        ? "Configured model not installed. Run ollama pull for the configured model."
        : "Ollama could not complete the local request. Check the local server and model.",
      response.status === 404 ? 404 : 502,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new AIError("Ollama returned an empty response.", 502);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new AIError("Ollama response exceeded the local limit.", 502);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new AIError("Ollama returned malformed JSON.", 502);
  }
}
export async function installedModel(
  base: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const result = (await boundedJSON(
    await fetch(`${base}/api/tags`, { signal, redirect: "error" }),
  )) as {
    models?: {
      name?: string;
      model?: string;
      remote_host?: unknown;
      remote_model?: unknown;
    }[];
  };
  if (!Array.isArray(result?.models))
    throw new AIError("Ollama returned invalid model information.", 502);
  const match = result.models.find(
    (item) =>
      item.name === model ||
      item.model === model ||
      item.name === `${model}:latest`,
  );
  if (!match)
    throw new AIError(
      `Model not installed: ${model}. Install it with ollama pull ${model}.`,
      404,
    );
  if (
    match.remote_host ||
    match.remote_model ||
    /cloud/i.test(match.name ?? "")
  )
    throw new AIError(
      "Cloud-backed models are disabled. Select a fully local model.",
      400,
    );
  return match.name ?? model;
}
/** Narrow validated Vite bridge: only local tags and non-streaming summary inference. */
export function localAIProxy(
  baseInput = "http://127.0.0.1:11434",
  modelInput = DEFAULT_AI_MODEL,
): Plugin {
  const base = validateOllamaTarget(baseInput),
    model = validateModel(modelInput);
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (!req.url?.startsWith("/api/ai/")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    const send = (status: number, value: unknown) => {
      if (!res.destroyed && !res.writableEnded) {
        res.statusCode = status;
        res.end(JSON.stringify(value));
      }
    };
    if (!(
      (req.url === "/api/ai/status" && req.method === "GET") ||
      (req.url === "/api/ai/summary" && req.method === "POST")
    ))
      return send(404, { error: "Unknown local AI endpoint or method." });
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    )
      return send(403, {
        error: "Local AI is available only from the same computer.",
      });
    // Only same-origin browser requests; the app itself makes no cross-origin calls.
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`)
    )
      return send(403, {
        error: "Local AI requests must come from this application origin.",
      });
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, AI_TIMEOUT_MS);
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", disconnected);
    try {
      if (req.url === "/api/ai/status") {
        await installedModel(base, model, controller.signal);
        send(200, { model });
        return;
      }
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new AIError("Send clinical context as JSON.", 415);
      const rawParts: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 30_000)
          throw new AIError("AI context request is too large.", 413);
        rawParts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      let source;
      try {
        source = validateSource(
          JSON.parse(Buffer.concat(rawParts).toString("utf8")),
        );
      } catch (error) {
        throw new AIError(
          error instanceof Error ? error.message : "Invalid clinical context.",
          400,
        );
      }
      const availableModel = await installedModel(
        base,
        model,
        controller.signal,
      );
      const result = await boundedJSON(
        await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest(source, availableModel)),
          signal: controller.signal,
          redirect: "error",
        }),
      );
      const parsed = parseOllamaResponse(result);
      if (
        parsed.model !== availableModel &&
        parsed.model !== model &&
        parsed.model !== `${model}:latest`
      )
        throw new AIError(
          "Ollama returned a different model than requested.",
          502,
        );
      send(200, parsed);
    } catch (error) {
      send(timedOut ? 504 : error instanceof AIError ? error.status : 502, {
        error: timedOut
          ? "Local AI request timed out. Your manual summary is unchanged."
          : error instanceof AIError
            ? error.message
            : error instanceof TypeError
              ? "Local AI server unavailable. Start Ollama and check the connection."
              : "The model returned an invalid summary. Regenerate or keep your manual summary.",
      });
    } finally {
      clearTimeout(timer);
      res.off("close", disconnected);
    }
  };
  return {
    name: "local-clinical-summary",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
