import type { ClinicalContext } from "../domain";

/** Future integration boundary only. There is no AI implementation or network call. */
export interface ClinicalSummarySuggestion {
  text: string;
  requiresClinicianReview: true;
}

export interface AISuggestionsProvider {
  summarizeClinicalHistory(
    context: ClinicalContext,
  ): Promise<ClinicalSummarySuggestion>;
}

export const aiSuggestionsAvailability = {
  enabled: false,
  description:
    "Future research: AI-assisted clinical summaries with clinician review. No AI runs in this prototype.",
} as const;
