import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface SummarySource {
  history: string;
  indication: string;
  notes: string;
}
/** Explicit allowlist: identifiers, existing summaries and imaging data never enter inference. */
export function summarySource(context: SummarySource): SummarySource {
  return {
    history: context.history,
    indication: context.indication,
    notes: context.notes,
  };
}
export function sourceKey(source: SummarySource): string {
  return JSON.stringify(summarySource(source));
}
export function sourceFingerprint(source: SummarySource): string {
  return bytesToHex(sha256(new TextEncoder().encode(sourceKey(source))));
}
export function hasSummarySource(source: SummarySource): boolean {
  return Object.values(summarySource(source)).some(
    (value) => value.trim().length > 0,
  );
}
