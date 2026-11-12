import {
  toLowHighRange,
  toWindowLevel,
} from "@cornerstonejs/core/utilities/windowLevel";
import VOILUTFunctionType from "@cornerstonejs/core/enums/VOILUTFunctionType";

type Range = { lower: number; upper: number };
function lutFunction(value?: string): VOILUTFunctionType {
  return value === VOILUTFunctionType.LINEAR_EXACT
    ? VOILUTFunctionType.LINEAR_EXACT
    : value === VOILUTFunctionType.SAMPLED_SIGMOID
      ? VOILUTFunctionType.SAMPLED_SIGMOID
      : VOILUTFunctionType.LINEAR;
}

/** DICOM LINEAR uses inclusive-width/half-pixel semantics; LINEAR_EXACT does not. */
export function windowFromRange(
  range: Range,
  voiFunction?: string,
): { width: number; center: number } {
  if (lutFunction(voiFunction) === VOILUTFunctionType.LINEAR_EXACT) {
    return {
      width: Math.abs(range.upper - range.lower),
      center: (range.upper + range.lower) / 2,
    };
  }
  const values = toWindowLevel(range.lower, range.upper);
  return { width: values.windowWidth, center: values.windowCenter };
}
export function rangeFromWindow(
  width: number,
  center: number,
  voiFunction?: string,
): Range {
  return toLowHighRange(width, center, lutFunction(voiFunction));
}
