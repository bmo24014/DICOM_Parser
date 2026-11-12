import type { ManualAnnotation, Series } from "../domain";

type ImageReference = ManualAnnotation["reference"];

/** Conservative UID check: synthesized fallback group keys are not DICOM UIDs. */
export function hasImageUID(value: string | undefined): value is string {
  return !!value && value.length <= 64 && /^\d+(?:\.\d+)+$/.test(value);
}

/** One immutable reference per stack frame; absent identifiers disable flagging. */
export function seriesFrameReferences(
  series: Series,
  studyInstanceUID: string | undefined,
): (ImageReference | null)[] {
  let sliceIndex = 0;
  return series.instances.flatMap((instance) =>
    Array.from({ length: instance.frameCount }, (_, frame) => {
      const reference =
        hasImageUID(studyInstanceUID) &&
        hasImageUID(series.id) &&
        hasImageUID(instance.sopInstanceUID)
          ? {
              studyInstanceUID,
              seriesInstanceUID: series.id,
              sopInstanceUID: instance.sopInstanceUID,
              frameNumber: frame + 1,
              sliceIndex,
            }
          : null;
      sliceIndex++;
      return reference;
    }),
  );
}

/** Resolve by stable DICOM identity; saved sliceIndex is descriptive, not trusted. */
export function annotationFrameIndex(
  region: ManualAnnotation,
  references: (ImageReference | null)[],
): number {
  return references.findIndex(
    (reference) =>
      !!reference &&
      reference.studyInstanceUID === region.reference.studyInstanceUID &&
      reference.seriesInstanceUID === region.reference.seriesInstanceUID &&
      reference.sopInstanceUID === region.reference.sopInstanceUID &&
      reference.frameNumber === region.reference.frameNumber,
  );
}
