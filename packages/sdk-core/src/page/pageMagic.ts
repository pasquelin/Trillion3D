/** Whether `bytes` open on `magic`, read as a little-endian `u32`: the first word of a page of any kind. */
export const opensWithMagic = (bytes: Uint8Array, magic: number) =>
  bytes.byteLength >= 4 &&
  new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === magic
