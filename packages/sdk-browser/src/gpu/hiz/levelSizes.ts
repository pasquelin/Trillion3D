export function hizLevelSizes(width: number, height: number): Array<[number, number]> {
  if (width < 1 || height < 1) throw new Error('HIZ_DEPTH_SIZE')
  const sizes: Array<[number, number]> = [[width, height]]
  while (sizes[sizes.length - 1][0] > 1 || sizes[sizes.length - 1][1] > 1) {
    const [w, h] = sizes[sizes.length - 1]
    sizes.push([Math.ceil(w / 2), Math.ceil(h / 2)])
  }
  return sizes
}
