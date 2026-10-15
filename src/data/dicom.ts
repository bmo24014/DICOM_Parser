import dicomParser from "dicom-parser";
import type { Series, Study } from "../domain";

export type { DicomInstance, Series, Study } from "../domain";

// Keep the browser's memory use bounded: the decoder also needs room for pixels.
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
export const MAX_IMPORT_FILES = 2_000;

/** Reads metadata locally. Original File objects (and their bytes) are preserved. */
export async function importLocalDicom(
  files: File[],
): Promise<{ studies: Study[]; warnings: string[] }> {
  if (files.length > MAX_IMPORT_FILES) {
    throw new Error(
      `Select at most ${MAX_IMPORT_FILES.toLocaleString()} files per import.`,
    );
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BYTES) {
    throw new Error(
      "Select at most 512 MB of DICOM files per import. Try one series at a time.",
    );
  }

  const studies = new Map<string, Study>();
  const seriesByStudy = new Map<string, Map<string, Series>>();
  const warnings: string[] = [];

  // Sequential reads avoid holding every source file in memory at once.
  for (const [index, file] of files.entries()) {
    if (file.name.toUpperCase() === "DICOMDIR") {
      warnings.push(
        "Skipped DICOMDIR: select the image files referenced by the directory.",
      );
      continue;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Part 10 files include their transfer syntax. Guessing a syntax for a raw
      // dataset risks interpreting pixel bytes incorrectly, so reject it clearly.
      if (
        bytes.length < 132 ||
        String.fromCharCode(...bytes.subarray(128, 132)) !== "DICM"
      ) {
        throw new Error("not a DICOM Part 10 file (missing DICM header)");
      }
      const dataset = dicomParser.parseDicom(bytes, { untilTag: "x7fe00010" });
      if (dataset.string("x00020002") === "1.2.840.10008.1.3.10") {
        throw new Error("DICOM directory records are not images");
      }
      if (!dataset.elements.x7fe00010) {
        throw new Error("no supported image pixel data");
      }

      const studyUid = dataset.string("x0020000d")?.trim();
      const seriesUid = dataset.string("x0020000e")?.trim();
      // When a UID is absent, never merge unrelated files by patient name,
      // description, or a shared empty string. A known series can still group
      // its own instances when only the study UID is missing.
      const studyId =
        studyUid || `missing-study:${seriesUid || `file-${index}`}`;
      const seriesId = seriesUid || `missing-series:file-${index}`;

      let study = studies.get(studyId);
      if (!study) {
        study = {
          id: studyId,
          description:
            dataset.string("x00081030")?.trim() ||
            `Local study ${studies.size + 1}`,
          series: [],
        };
        studies.set(studyId, study);
        seriesByStudy.set(studyId, new Map());
      }

      const studySeries = seriesByStudy.get(studyId)!;
      let series = studySeries.get(seriesId);
      if (!series) {
        series = {
          id: seriesId,
          description:
            dataset.string("x0008103e")?.trim() ||
            `Series ${study.series.length + 1}`,
          modality: dataset.string("x00080060")?.trim() || "DICOM",
          instances: [],
        };
        studySeries.set(seriesId, series);
        study.series.push(series);
      }

      const rawInstanceNumber = Number(dataset.string("x00200013"));
      const rawFrameCount = Number(dataset.string("x00280008") || 1);
      if (
        !Number.isInteger(rawFrameCount) ||
        rawFrameCount < 1 ||
        rawFrameCount > 20_000
      ) {
        throw new Error("invalid or excessive frame count");
      }
      series.instances.push({
        id: `local-instance-${index}`,
        file,
        instanceNumber: Number.isFinite(rawInstanceNumber)
          ? rawInstanceNumber
          : index + 1,
        frameCount: rawFrameCount,
      });
      if (!studyUid || !seriesUid) {
        warnings.push(
          `File ${index + 1}: missing study or series UID; grouped conservatively.`,
        );
      }
    } catch (error) {
      warnings.push(
        `File ${index + 1}: ${error instanceof Error ? error.message : "could not read DICOM metadata"}.`,
      );
    }
  }

  for (const study of studies.values()) {
    for (const series of study.series) {
      series.instances.sort((a, b) => a.instanceNumber - b.instanceNumber);
    }
    study.series = study.series.filter((series) => series.instances.length > 0);
  }

  return {
    studies: [...studies.values()].filter((study) => study.series.length > 0),
    warnings,
  };
}
