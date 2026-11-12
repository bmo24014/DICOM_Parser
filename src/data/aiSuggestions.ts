import {
  AI_TIMEOUT_MS,
  validateSource,
  validateSummaryText,
} from "./aiProtocol";
import type { SummarySource } from "./summarySource";
export interface ClinicalSummarySuggestion {
  text: string;
  model: string;
  generatedAt: string;
}
export interface AIRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface AISuggestionsProvider {
  checkAvailability(options?: AIRequestOptions): Promise<{ model: string }>;
  summarizeClinicalHistory(
    source: SummarySource,
    options?: AIRequestOptions,
  ): Promise<ClinicalSummarySuggestion>;
}
async function localRequest(
  path: string,
  source: SummarySource | undefined,
  options: AIRequestOptions = {},
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (options.signal?.aborted) throw new Error("AI request cancelled.");
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? AI_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: source ? "POST" : "GET",
      headers: source ? { "Content-Type": "application/json" } : undefined,
      body: source ? JSON.stringify(source) : undefined,
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    const value = await response.json().catch(() => {
      throw new Error(
        "The local AI connection returned an invalid response. Run the app through Vite development or preview.",
      );
    });
    if (!response.ok)
      throw new Error(
        typeof value?.error === "string"
          ? value.error
          : "Local AI is unavailable. Check Ollama and your installed model.",
      );
    return value;
  } catch (error) {
    if (timedOut)
      throw new Error(
        "AI request timed out. Your saved summary is unchanged; try again or use manual editing.",
      );
    if (controller.signal.aborted) throw new Error("AI request cancelled.");
    if (error instanceof TypeError)
      throw new Error(
        "Local AI server unavailable. Start Ollama locally and check the connection.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
export async function checkAIAvailability(
  options?: AIRequestOptions,
): Promise<{ model: string }> {
  const value = (await localRequest("/api/ai/status", undefined, options)) as {
    model?: unknown;
  };
  if (
    typeof value?.model !== "string" ||
    !value.model.trim() ||
    value.model.length > 200
  )
    throw new Error(
      "The local AI connection returned invalid model information.",
    );
  return { model: value.model };
}
export async function generateAISummary(
  source: SummarySource,
  options?: AIRequestOptions,
): Promise<ClinicalSummarySuggestion> {
  const value = (await localRequest(
    "/api/ai/summary",
    validateSource(source),
    options,
  )) as Record<string, unknown>;
  if (
    !value ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    value.model.length > 200 ||
    typeof value.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.generatedAt,
    ) ||
    !Number.isFinite(Date.parse(value.generatedAt))
  )
    throw new Error("The local model returned a malformed response.");
  return {
    text: validateSummaryText(value.text),
    model: value.model,
    generatedAt: value.generatedAt,
  };
}
export const localAIProvider: AISuggestionsProvider = {
  checkAvailability: checkAIAvailability,
  summarizeClinicalHistory: generateAISummary,
};
