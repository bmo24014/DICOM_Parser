/**
 * Original, generated test pattern, dedicated to CC0-1.0 by this project.
 * No external dataset, patient data, anatomy, or MRI acquisition is used.
 * Creates a minimal Secondary Capture Part 10 file for decoder smoke tests.
 */
export function syntheticDicom(
  instanceNumber = 1,
  transferSyntax = "1.2.840.10008.1.2.1",
): Buffer {
  const u16 = (value: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    return b;
  };
  const u32 = (value: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value);
    return b;
  };
  const element = (
    group: number,
    tag: number,
    vr: string,
    value: string | Buffer,
  ) => {
    let payload = typeof value === "string" ? Buffer.from(value) : value;
    if (payload.length % 2)
      payload = Buffer.concat([payload, Buffer.from([vr === "UI" ? 0 : 32])]);
    const length = ["OB", "OW", "SQ", "UN", "UT"].includes(vr)
      ? Buffer.concat([u16(0), u32(payload.length)])
      : u16(payload.length);
    return Buffer.concat([
      u16(group),
      u16(tag),
      Buffer.from(vr),
      length,
      payload,
    ]);
  };
  const sop = "1.2.840.10008.5.1.4.1.1.7";
  const uid = `2.25.1200000000000000000000000000000000${instanceNumber}`;
  const meta = Buffer.concat([
    element(2, 1, "OB", Buffer.from([0, 1])),
    element(2, 2, "UI", sop),
    element(2, 3, "UI", uid),
    element(2, 0x10, "UI", transferSyntax),
    element(2, 0x12, "UI", "2.25.129999999999999999999999999999999999"),
  ]);
  const pixels = Buffer.alloc(64 * 64 * 2);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      // Bright disk over horizontal ramp: easy to distinguish from a blank canvas.
      const disk =
        (x - 32) ** 2 + (y - 32) ** 2 < (8 + instanceNumber * 2) ** 2;
      pixels.writeUInt16LE(disk ? 3500 : x * 40, (y * 64 + x) * 2);
    }
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from("DICM"),
    element(2, 0, "UL", u32(meta.length)),
    meta,
    element(8, 0x16, "UI", sop),
    element(8, 0x18, "UI", uid),
    element(8, 0x60, "CS", "OT"),
    element(8, 0x64, "CS", "WSD"),
    element(8, 0x1030, "LO", "Synthetic software test"),
    element(8, 0x103e, "LO", "Generated nonanatomical pattern"),
    element(0x20, 0x0d, "UI", "2.25.100000000000000000000000000000000001"),
    element(0x20, 0x0e, "UI", "2.25.100000000000000000000000000000000002"),
    element(0x20, 0x13, "IS", String(instanceNumber)),
    element(0x28, 2, "US", u16(1)),
    element(0x28, 4, "CS", "MONOCHROME2"),
    element(0x28, 0x10, "US", u16(64)),
    element(0x28, 0x11, "US", u16(64)),
    element(0x28, 0x30, "DS", "1\\1"),
    element(0x28, 0x100, "US", u16(16)),
    element(0x28, 0x101, "US", u16(12)),
    element(0x28, 0x102, "US", u16(11)),
    element(0x28, 0x103, "US", u16(0)),
    element(0x28, 0x1050, "DS", "1750"),
    element(0x28, 0x1051, "DS", "3500"),
    element(0x7fe0, 0x10, "OW", pixels),
  ]);
}
