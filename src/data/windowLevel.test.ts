import { describe, expect, it } from "vitest";
import { rangeFromWindow, windowFromRange } from "./windowLevel";

describe("DICOM window/level controls", () => {
  it("shows the original LINEAR metadata values after reset", () => {
    expect(windowFromRange({ lower: 0, upper: 3499 }, "LINEAR")).toEqual({
      width: 3500,
      center: 1750,
    });
    expect(rangeFromWindow(3500, 1750, "LINEAR")).toEqual({
      lower: 0,
      upper: 3499,
    });
  });
  it("respects LINEAR_EXACT without the half-pixel adjustment", () => {
    expect(windowFromRange({ lower: 0, upper: 3500 }, "LINEAR_EXACT")).toEqual({
      width: 3500,
      center: 1750,
    });
    expect(rangeFromWindow(3500, 1750, "LINEAR_EXACT")).toEqual({
      lower: 0,
      upper: 3500,
    });
  });
  it("roundtrips narrow, fractional, negative-center and sigmoid values", () => {
    for (const lut of [undefined, "LINEAR", "LINEAR_EXACT", "SIGMOID"]) {
      for (const [width, center] of [
        [1, 0],
        [40, -120],
        [100.5, 5.25],
      ]) {
        expect(
          windowFromRange(rangeFromWindow(width, center, lut), lut),
        ).toEqual({ width, center });
      }
    }
  });
});
