import { describe, expect, it, vi } from "vitest";
import { importLocalDicom, MAX_IMPORT_BYTES, MAX_IMPORT_FILES } from "./dicom";

interface SyntheticImage {
  studyUid?: string | null;
  seriesUid?: string | null;
  instanceNumber?: number;
  frameCount?: number;
  pixelData?: boolean;
}

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

/** An explicit-VR little-endian element, including DICOM's even-length padding. */
function element(
  group: number,
  tag: number,
  vr: string,
  value: string | Uint8Array,
): Uint8Array {
  let payload = typeof value === "string" ? encoder.encode(value) : value;
  if (payload.length % 2 !== 0) {
    payload = concat(payload, new Uint8Array([vr === "UI" ? 0 : 32]));
  }
  const longLength = vr === "OB" || vr === "OW";
  return concat(
    uint16(group),
    uint16(tag),
    encoder.encode(vr),
    ...(longLength
      ? [uint16(0), uint32(payload.length)]
      : [uint16(payload.length)]),
    payload,
  );
}

/** Original, fictional 1×1 images assembled in memory; no patient fixtures. */
function part10Image(options: SyntheticImage = {}): Uint8Array {
  const studyUid =
    options.studyUid === undefined
      ? "1.2.826.0.1.3680043.10.999.1"
      : options.studyUid;
  const seriesUid =
    options.seriesUid === undefined
      ? "1.2.826.0.1.3680043.10.999.1.1"
      : options.seriesUid;
  const sopClass = "1.2.840.10008.5.1.4.1.1.2";
  const sopInstance = `1.2.826.0.1.3680043.10.999.9.${options.instanceNumber ?? 1}`;
  const meta = concat(
    element(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
    element(0x0002, 0x0002, "UI", sopClass),
    element(0x0002, 0x0003, "UI", sopInstance),
    element(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"),
    element(0x0002, 0x0012, "UI", "1.2.826.0.1.3680043.10.999"),
  );
  const dataset = [
    element(0x0008, 0x0016, "UI", sopClass),
    element(0x0008, 0x0018, "UI", sopInstance),
    element(0x0008, 0x0060, "CS", "CT"),
    element(0x0008, 0x1030, "LO", "Fictional test study"),
    element(0x0008, 0x103e, "LO", "Fictional test series"),
  ];
  if (studyUid !== null) dataset.push(element(0x0020, 0x000d, "UI", studyUid));
  if (seriesUid !== null)
    dataset.push(element(0x0020, 0x000e, "UI", seriesUid));
  dataset.push(
    element(0x0020, 0x0013, "IS", String(options.instanceNumber ?? 1)),
    element(0x0028, 0x0002, "US", uint16(1)),
    element(0x0028, 0x0004, "CS", "MONOCHROME2"),
  );
  if (options.frameCount !== undefined) {
    dataset.push(element(0x0028, 0x0008, "IS", String(options.frameCount)));
  }
  dataset.push(
    element(0x0028, 0x0010, "US", uint16(1)),
    element(0x0028, 0x0011, "US", uint16(1)),
    element(0x0028, 0x0100, "US", uint16(16)),
    element(0x0028, 0x0101, "US", uint16(16)),
    element(0x0028, 0x0102, "US", uint16(15)),
    element(0x0028, 0x0103, "US", uint16(0)),
  );
  if (options.pixelData !== false) {
    dataset.push(
      element(
        0x7fe0,
        0x0010,
        "OW",
        new Uint8Array(2 * (options.frameCount ?? 1)),
      ),
    );
  }
  return concat(
    new Uint8Array(128),
    encoder.encode("DICM"),
    element(0x0002, 0x0000, "UL", uint32(meta.length)),
    meta,
    ...dataset,
  );
}

// Node test runners need only the File methods consumed by the importer.
function localFile(name: string, bytes = part10Image()): File {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

describe("importLocalDicom", () => {
  it("groups by study and series UID, and sorts instances numerically", async () => {
    const late = localFile("late.dcm", part10Image({ instanceNumber: 30 }));
    const early = localFile("early.dcm", part10Image({ instanceNumber: 2 }));
    const middle = localFile("middle.dcm", part10Image({ instanceNumber: 10 }));
    const otherSeries = localFile(
      "other-series.dcm",
      part10Image({ seriesUid: "1.2.3.2" }),
    );
    const otherStudy = localFile(
      "other-study.dcm",
      part10Image({ studyUid: "1.2.4", seriesUid: "1.2.4.1" }),
    );

    const result = await importLocalDicom([
      late,
      otherSeries,
      early,
      otherStudy,
      middle,
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.studies).toHaveLength(2);
    expect(result.studies[0].series).toHaveLength(2);
    expect(result.studies[0].series[0]).toMatchObject({
      description: "Fictional test series",
      modality: "CT",
    });
    expect(
      result.studies[0].series[0].instances.map(
        (instance) => instance.instanceNumber,
      ),
    ).toEqual([2, 10, 30]);
    expect(
      result.studies[0].series[0].instances.map((instance) => instance.file),
    ).toEqual([early, middle, late]);
    expect(result.studies[0].series[1].instances[0].file).toBe(otherSeries);
    expect(result.studies[1].series[0].instances[0].file).toBe(otherStudy);
  });

  it("records multiframe counts and defaults single-frame images to one frame", async () => {
    const result = await importLocalDicom([
      localFile("multi.dcm", part10Image({ frameCount: 3, instanceNumber: 1 })),
      localFile("single.dcm", part10Image({ instanceNumber: 2 })),
    ]);

    expect(result.warnings).toEqual([]);
    expect(
      result.studies[0].series[0].instances.map(
        (instance) => instance.frameCount,
      ),
    ).toEqual([3, 1]);
  });

  it("accepts a Part 10 image without a filename extension", async () => {
    const file = localFile("IM000001");
    const result = await importLocalDicom([file]);

    expect(result.warnings).toEqual([]);
    expect(result.studies[0].series[0].instances[0].file).toBe(file);
  });

  it("skips non-DICOM files with a warning while retaining valid images", async () => {
    const good = localFile("image.dcm");
    const result = await importLocalDicom([
      good,
      localFile("readme.txt", encoder.encode("This is not a DICOM image.")),
    ]);

    expect(result.studies).toHaveLength(1);
    expect(result.studies[0].series[0].instances).toHaveLength(1);
    expect(result.studies[0].series[0].instances[0].file).toBe(good);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("File 2:");
    expect(result.warnings[0]).toContain("missing DICM header");
  });

  it.each([0, 20_001])(
    "rejects an invalid frame count of %i",
    async (frameCount) => {
      const result = await importLocalDicom([
        localFile("invalid-frames.dcm", part10Image({ frameCount })),
      ]);

      expect(result.studies).toEqual([]);
      expect(result.warnings).toEqual([
        "File 1: invalid or excessive frame count.",
      ]);
    },
  );

  it.each(["DICOMDIR", "dicomdir"])(
    "skips %s without reading its contents",
    async (name) => {
      const arrayBuffer = vi.fn(async () => {
        throw new Error("Directory contents must not be read");
      });
      const file = { name, size: 128, arrayBuffer } as unknown as File;

      const result = await importLocalDicom([file]);

      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(result.studies).toEqual([]);
      expect(result.warnings).toEqual([
        "Skipped DICOMDIR: select the image files referenced by the directory.",
      ]);
    },
  );

  it("rejects a Part 10 dataset without image pixel data", async () => {
    const result = await importLocalDicom([
      localFile("metadata-only.dcm", part10Image({ pixelData: false })),
    ]);

    expect(result.studies).toEqual([]);
    expect(result.warnings).toEqual(["File 1: no supported image pixel data."]);
  });

  it("rejects too many files before reading any file", async () => {
    const arrayBuffer = vi.fn(async () => {
      throw new Error("Oversized imports must not be read");
    });
    const file = { name: "image.dcm", size: 1, arrayBuffer } as unknown as File;
    const files = Array.from({ length: MAX_IMPORT_FILES + 1 }, () => file);

    await expect(importLocalDicom(files)).rejects.toThrow(
      `Select at most ${MAX_IMPORT_FILES.toLocaleString()} files per import.`,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects an excessive combined file size before reading any file", async () => {
    const arrayBuffer = vi.fn(async () => {
      throw new Error("Oversized imports must not be read");
    });
    const file = {
      name: "image.dcm",
      size: MAX_IMPORT_BYTES / 2 + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(importLocalDicom([file, file])).rejects.toThrow(
      "Select at most 512 MB",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("keeps unrelated images separate when both grouping UIDs are absent", async () => {
    const result = await importLocalDicom([
      localFile("one.dcm", part10Image({ studyUid: null, seriesUid: null })),
      localFile("two.dcm", part10Image({ studyUid: null, seriesUid: null })),
    ]);

    expect(result.studies).toHaveLength(2);
    expect(result.studies[0].id).not.toBe(result.studies[1].id);
    expect(
      result.studies.every(
        (study) =>
          study.series.length === 1 && study.series[0].instances.length === 1,
      ),
    ).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(
      result.warnings.every((warning) =>
        warning.includes("grouped conservatively"),
      ),
    ).toBe(true);
  });

  it("keeps separate series for images with a known study but missing series UIDs", async () => {
    const result = await importLocalDicom([
      localFile("one.dcm", part10Image({ seriesUid: null })),
      localFile("two.dcm", part10Image({ seriesUid: null })),
    ]);

    expect(result.studies).toHaveLength(1);
    expect(result.studies[0].series).toHaveLength(2);
    expect(result.studies[0].series[0].id).not.toBe(
      result.studies[0].series[1].id,
    );
    expect(result.warnings).toHaveLength(2);
  });

  it("groups a known series with missing study UIDs without combining other series", async () => {
    const result = await importLocalDicom([
      localFile("one.dcm", part10Image({ studyUid: null, instanceNumber: 2 })),
      localFile("two.dcm", part10Image({ studyUid: null, instanceNumber: 1 })),
      localFile(
        "other.dcm",
        part10Image({ studyUid: null, seriesUid: "1.2.3.9" }),
      ),
    ]);

    expect(result.studies).toHaveLength(2);
    expect(result.studies[0].series).toHaveLength(1);
    expect(
      result.studies[0].series[0].instances.map(
        (instance) => instance.instanceNumber,
      ),
    ).toEqual([1, 2]);
    expect(result.studies[1].series[0].instances).toHaveLength(1);
    expect(result.warnings).toHaveLength(3);
  });

  it("retains the original File reference and leaves its bytes unchanged", async () => {
    const bytes = part10Image({ frameCount: 2 });
    const original = bytes.slice();
    const file = localFile("original.dcm", bytes);

    const result = await importLocalDicom([file]);

    expect(result.studies[0].series[0].instances[0].file).toBe(file);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(original);
    expect(bytes).toEqual(original);
  });
});
