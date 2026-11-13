export function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([
    255, 216, 255, 192, 0, 17, 8, 0, 0, 0, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes;
}

export function jpeg(width: number, height: number): Blob {
  return new Blob([jpegBytes(width, height)], { type: "image/jpeg" });
}
function box(type: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + payload.length);
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(payload, 8);
  return result;
}
export function heif(width = 4032, height = 3024): Blob {
  const size = new Uint8Array(12);
  const view = new DataView(size.buffer);
  view.setUint32(4, width);
  view.setUint32(8, height);
  const props = box("iprp", box("ipco", box("ispe", size)));
  const meta = new Uint8Array(props.length + 4);
  meta.set(props, 4);
  return new Blob(
    [
      box("ftyp", new TextEncoder().encode("heic\0\0\0\0heic")),
      box("meta", meta),
      box("mdat", new Uint8Array(1)),
    ],
    { type: "image/heic" },
  );
}
