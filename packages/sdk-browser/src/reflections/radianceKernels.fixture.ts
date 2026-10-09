// The radiance pyramid's shipped kernels (`RADIANCE_SHADER`) run as JavaScript for its tests, over
// images of texels read as the sampler reads them, bilinear, their edge clamped.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { RADIANCE_SHADER } from './gpu.ts'

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
export const blank = (width: number, height: number) =>
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

/** The shipped kernels over `finer` into `coarser`, `coarsest` (and `copy`), `drawn` the image's
 *  drawn size. */
export function radianceKernels(drawn: number[]) {
  const binding = { finer: {}, coarser: {}, coarsest: {}, copy: {} }
  const io: Record<keyof typeof binding, Image> = {
    finer: blank(1, 1),
    coarser: blank(1, 1),
    coarsest: blank(1, 1),
    copy: blank(1, 1),
  }
  const of = (t: object) =>
    io[(Object.keys(binding) as (keyof typeof binding)[]).find((k) => binding[k] === t)!]
  const run = shaderRun<{
    radianceFirst: (id: number[]) => void
    radianceDown: (id: number[]) => void
  }>(RADIANCE_SHADER, ['radianceFirst', 'radianceDown', 'radianceTwo', 'radianceTent', 'tent'], {
    ...binding,
    halves: {},
    drawn,
    textureDimensions: (t: object) => [of(t).width, of(t).height],
    textureLoad: (t: object, p: number[]) => of(t).texels[p[1] * of(t).width + p[0]],
    textureSampleLevel: (t: object, _: unknown, uv: number[]) => bilinear(of(t), uv),
    textureStore: (t: object, p: number[], value: number[]) => {
      of(t).texels[p[1] * of(t).width + p[0]] = value
    },
  })
  /** Each kernel over its whole grid: `threads` a side. */
  const dispatch = (kernel: (id: number[]) => void, threads: number[]) => {
    for (let y = 0; y < threads[1]; y++) for (let x = 0; x < threads[0]; x++) kernel([x, y, 0])
  }
  return {
    first(source: Image) {
      io.finer = source
      io.copy = blank(source.width, source.height)
      io.coarser = blank(source.width >> 1, source.height >> 1)
      io.coarsest = blank(source.width >> 2, source.height >> 2)
      dispatch(run.radianceFirst, [Math.ceil(source.width / 4), Math.ceil(source.height / 4)])
      return { copy: io.copy, coarser: io.coarser, coarsest: io.coarsest }
    },
    down(source: Image) {
      io.finer = source
      io.coarser = blank(source.width >> 1, source.height >> 1)
      io.coarsest = blank(io.coarser.width >> 1, io.coarser.height >> 1)
      dispatch(run.radianceDown, [
        Math.ceil(io.coarser.width / 2),
        Math.ceil(io.coarser.height / 2),
      ])
      return { coarser: io.coarser, coarsest: io.coarsest }
    },
  }
}
