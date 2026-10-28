import { PIXEL_FORMATS } from './sparseVolumeFile.ts'
import { floatToHalf } from './halfFloat.ts'

/** The cells of an atlas along each side for `tiles` tiles: the smallest cube, trimmed along z, then
 *  y, then x while the volume still holds them all. */
export function atlasResolutionInTiles(tiles: number): [number, number, number] {
  let cube = 1
  while (cube ** 3 < tiles) cube++
  const size: [number, number, number] = [cube, cube, cube]
  for (const axis of [2, 1, 0]) {
    const trimmed = [...size] as [number, number, number]
    trimmed[axis]--
    while (trimmed[0] * trimmed[1] * trimmed[2] > tiles) {
      size[axis]--
      trimmed[axis]--
    }
  }
  return size
}

/** The cell of atlas tile `rank` (0 the null tile), `x` fastest. */
export function atlasCell(rank: number, size: readonly [number, number, number]) {
  return [
    rank % size[0],
    Math.floor(rank / size[0]) % size[1],
    Math.floor(rank / (size[0] * size[1])),
  ] as const
}

/** The bytes of one voxel of `format` holding `value`, as a tile stores a voxel at the fallback. */
export function fallbackVoxel(format: number, value: Float32Array): Uint8Array {
  const { name, bytes } = PIXEL_FORMATS[format]
  const out = new Uint8Array(bytes)
  const view = new DataView(out.buffer)
  const unorm = (x: number) => Math.floor(Math.min(Math.max(x, 0), 1) * 255)
  switch (name) {
    case 'R8':
      out[0] = unorm(value[0])
      break
    case 'R8G8':
      out.set([unorm(value[0]), unorm(value[1])])
      break
    case 'R8G8B8A8':
      out.set([0, 1, 2, 3].map((c) => unorm(value[c])))
      break
    case 'R16F':
    case 'G16R16F':
    case 'FloatRGBA':
      for (let c = 0; c < bytes / 2; c++) view.setUint16(c * 2, floatToHalf(value[c]), true)
      break
  }
  return out
}
