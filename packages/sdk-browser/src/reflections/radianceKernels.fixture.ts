// The radiance pyramid's shipped kernels (`RADIANCE_SHADER`) run as JavaScript for its tests, over
// images of texels read as the sampler reads them, bilinear, their edge clamped.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { RADIANCE_SHADER } from './radiance.ts'

export type Image = { width: number; height: number; texels: number[][] }
export const image = (
  width: number,
  height: number,
  at: (x: number, y: number) => number[],
): Image => ({
  width,
  height,
  texels: Array.from({ length: width * height }, (_, i) => at(i % width, Math.floor(i / width))),
})
const blank = (width: number, height: number) =>
  image(Math.max(1, width), Math.max(1, height), () => [0, 0, 0, 0])

/** An image's bilinear read at `uv`, as the sampler reads it, its edge clamped. */
export function bilinear(level: Image, uv: number[]) {
  const u = uv[0] * level.width - 0.5,
    v = uv[1] * level.height - 0.5
  const x0 = Math.floor(u),
    y0 = Math.floor(v),
    fx = u - x0,
    fy = v - y0
  const texel = (i: number, j: number) =>
    level.texels[
      Math.min(Math.max(j, 0), level.height - 1) * level.width +
        Math.min(Math.max(i, 0), level.width - 1)
    ]
  return [0, 1, 2, 3].map(
    (c) =>
      (1 - fy) * ((1 - fx) * texel(x0, y0)[c] + fx * texel(x0 + 1, y0)[c]) +
      fy * ((1 - fx) * texel(x0, y0 + 1)[c] + fx * texel(x0 + 1, y0 + 1)[c]),
  )
}

/** The shipped kernels over `finer` into `coarser`, `coarsest`, `drawn` the image's drawn size. A workgroup runs as the device runs it: every thread's tents (`radianceFill`) into
 *  its tile, then — past the barrier — every thread's sum (`radianceSum`) from it. */
export function radianceKernels(drawn: number[]) {
  const binding = { finer: {}, coarser: {}, coarsest: {}, previous: {} }
  const io: Record<keyof typeof binding, Image> = {
    finer: blank(1, 1),
    coarser: blank(1, 1),
    coarsest: blank(1, 1),
    previous: blank(1, 1),
  }
  const of = (t: object) =>
    io[(Object.keys(binding) as (keyof typeof binding)[]).find((k) => binding[k] === t)!]
  const tile: number[][] = []
  const run = shaderRun<{
    radianceFill: (lane: number, wg: number[], bounds: number[]) => void
    radianceSum: (lid: number[], wg: number[]) => void
    radianceFold: (image: object, c: number[]) => number[]
  }>(
    RADIANCE_SHADER,
    [
      'radianceFill',
      'radianceSum',
      'radianceFold',
      'radianceTent',
      'tent',
      'radianceHash',
      'mixWord',
    ],
    {
      ...binding,
      halves: {},
      tile,
      view: { viewport: drawn },
      textureDimensions: (t: object) => [of(t).width, of(t).height],
      textureLoad: (t: object, p: number[]) => of(t).texels[p[1] * of(t).width + p[0]],
      textureSampleLevel: (t: object, _: unknown, uv: number[]) => bilinear(of(t), uv),
      textureStore: (t: object, p: number[], value: number[]) => {
        of(t).texels[p[1] * of(t).width + p[0]] = value
      },
    },
  )
  /** The workgroups over `groups` a side, each as the device runs it; `hashed` the first kernel's
   *  of a still image, which also folds the image into its hash — and, `both`, the image before it
   *  into the words beside —: the sum of its threads', two words each. */
  const dispatch = (groups: number[], bounds: number[], hashed: boolean, both = false) => {
    const hash = [0, 0, 0, 0]
    for (let y = 0; y < groups[1]; y++)
      for (let x = 0; x < groups[0]; x++) {
        for (let lane = 0; lane < 64; lane++) run.radianceFill(lane, [x, y], bounds)
        for (let lane = 0; lane < 64; lane++) {
          const lid = [lane % 8, Math.floor(lane / 8)]
          run.radianceSum(lid, [x, y])
          const c = [x * 8 + lid[0], y * 8 + lid[1]]
          if (hashed) {
            const sum = run.radianceFold(binding.finer, c)
            hash[0] = (hash[0] + sum[0]) >>> 0
            hash[1] = (hash[1] + sum[1]) >>> 0
          }
          if (both) {
            const sum = run.radianceFold(binding.previous, c)
            hash[2] = (hash[2] + sum[0]) >>> 0
            hash[3] = (hash[3] + sum[1]) >>> 0
          }
        }
      }
    return hash
  }
  return {
    /** The first kernel over `source`, in `groups` workgroups a side (the shipped dispatch,
     *  `radianceGroups`, else whole), hashing it; with `before`, the one that hashes the image
     *  before it too (`radianceFirstBoth`), its words in `before`. */
    first(
      source: Image,
      groups = [Math.ceil(source.width / 32), Math.ceil(source.height / 32)],
      before?: Image,
    ) {
      io.finer = source
      io.previous = before ?? blank(1, 1)
      io.coarser = blank(source.width >> 1, source.height >> 1)
      io.coarsest = blank(source.width >> 2, source.height >> 2)
      const words = dispatch(groups, drawn, true, !!before)
      return {
        coarser: io.coarser,
        coarsest: io.coarsest,
        hash: words.slice(0, 2),
        before: words.slice(2),
      }
    },
    down(source: Image) {
      io.finer = source
      io.coarser = blank(source.width >> 1, source.height >> 1)
      io.coarsest = blank(io.coarser.width >> 1, io.coarser.height >> 1)
      dispatch(
        [Math.ceil(io.coarsest.width / 8), Math.ceil(io.coarsest.height / 8)],
        [source.width, source.height],
        false,
      )
      return { coarser: io.coarser, coarsest: io.coarsest }
    },
  }
}
