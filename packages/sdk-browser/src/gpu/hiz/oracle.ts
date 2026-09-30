function hizLevelSizes(width: number, height: number): Array<[number, number]> {
  if (width < 1 || height < 1) throw new Error('HIZ_DEPTH_SIZE');
  const sizes: Array<[number, number]> = [[width, height]];
  while (sizes[sizes.length - 1][0] > 1 || sizes[sizes.length - 1][1] > 1) {
    const [w, h] = sizes[sizes.length - 1];
    sizes.push([Math.ceil(w / 2), Math.ceil(h / 2)]);
  }
  return sizes;
}

/** A packed pyramid's mip sizes, each mip's first texel and its whole size in bytes. */
export function pyramidBytes(width: number, height: number) {
  const sizes = hizLevelSizes(width, height);
  const offsets: number[] = [];
  let texels = 0;
  for (const [w, h] of sizes) {
    offsets.push(texels);
    texels += w * h;
  }
  return { sizes, offsets, texels, bytes: Math.max(4, texels * 4) };
}
