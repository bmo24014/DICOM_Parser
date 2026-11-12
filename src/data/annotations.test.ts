import { describe, expect, it } from "vitest";
import type { ManualAnnotation, Series } from "../domain";
import { annotationFrameIndex, seriesFrameReferences } from "./annotations";

const series: Series = {
  id: "2.25.2",
  description: "Synthetic test",
  modality: "OT",
  instances: [
    {
      id: "one",
      file: {} as File,
      instanceNumber: 1,
      frameCount: 1,
      sopInstanceUID: "2.25.3",
    },
    {
      id: "two",
      file: {} as File,
      instanceNumber: 2,
      frameCount: 2,
      sopInstanceUID: "2.25.4",
    },
  ],
};
function region(reference: ManualAnnotation["reference"]): ManualAnnotation {
  return {
    id: "region-one",
    source: "manual",
    shape: "rectangle",
    description: "Manual",
    reference,
    points: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    viewPlaneNormal: [0, 0, 1],
    viewUp: [0, 1, 0],
  };
}

describe("portable manual annotation references", () => {
  it("expands multiframe images and records one-based frame/zero-based stack indices", () => {
    const refs = seriesFrameReferences(series, "2.25.1");
    expect(
      refs.map((item) => [
        item?.sopInstanceUID,
        item?.frameNumber,
        item?.sliceIndex,
      ]),
    ).toEqual([
      ["2.25.3", 1, 0],
      ["2.25.4", 1, 1],
      ["2.25.4", 2, 2],
    ]);
  });
  it("resolves stable SOP/frame identity instead of trusting a saved stack index", () => {
    const refs = seriesFrameReferences(series, "2.25.1");
    expect(
      annotationFrameIndex(region({ ...refs[2]!, sliceIndex: 99 }), refs),
    ).toBe(2);
  });
  it("does not show a region on a different image, frame, series, or study", () => {
    const refs = seriesFrameReferences(series, "2.25.1");
    const base = region(refs[0]!);
    for (const change of [
      { studyInstanceUID: "2.25.9" },
      { seriesInstanceUID: "2.25.9" },
      { sopInstanceUID: "2.25.9" },
      { frameNumber: 9 },
    ]) {
      expect(
        annotationFrameIndex(
          { ...base, reference: { ...base.reference, ...change } },
          refs,
        ),
      ).toBe(-1);
    }
  });
  it("disables annotation creation for missing or synthetic UID references", () => {
    expect(seriesFrameReferences(series, "missing-study:1")).toEqual([
      null,
      null,
      null,
    ]);
    expect(
      seriesFrameReferences(
        {
          ...series,
          instances: [{ ...series.instances[0], sopInstanceUID: undefined }],
        },
        "2.25.1",
      ),
    ).toEqual([null]);
  });
});
