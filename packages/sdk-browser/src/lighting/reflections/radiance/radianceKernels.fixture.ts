// The radiance pyramid's shipped kernels (`RADIANCE_SHADER`) run as JavaScript for its tests, over
// images of texels read as the sampler reads them, bilinear, their edge clamped.
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { RADIANCE_SHADER } from './radianceWgsl.ts'
import { REFLECTION_SIDE as SIDE } from '../constants.ts'
import { bilinearRead } from '../../../materials/texture/bilinear.fixture.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { heldImage } from '../heldImage.fixture.ts'
import { encodeRadiancePyramid, type RadianceInputs } from './radianceBuild.ts'

/** A radiance pyramid of `levels` over `width × height` as `encodeRadiancePyramid` reads it: its
 *  level 0 the view `view`, no image held, no group built. */
export const fakePyramid = (levels: number, width: number, height: number, view: unknown = {}) =>
  ({
    levels,
    width,
    height,
    image: { view },
    held: heldImage(),
    build: { identity: createWebgpuBindIdentity(2), slots: [] },
  }) as unknown as Parameters<typeof encodeRadiancePyramid>[2]

/** What a recorded build saw: the pipelines it set, the workgroups it dispatched and the entries
 *  of the groups it made, in order. */
type BuildRecord = {
  pipelines: unknown[]
  dispatches: number[][]
  groups: GPUBindGroupEntry[][]
}

/**
 * The shipped build (`encodeRadiancePyramid`) of `pyramid` over stand-ins, recorded: a pass and a
 * device that only remember what they are given, the frame's HDR target `hdr` (by default one of
 * the pyramid's levels whose views are blank), the pipelines `pipelines` (none by default). Each
 * `build` of an image of `size` seen through `viewProjection` returns its own record.
 */
export function recordedBuild(
  pyramid: Parameters<typeof encodeRadiancePyramid>[2],
  hdr: unknown = { mipLevelCount: pyramid.levels, createView: () => ({}) },
  pipelines: unknown = {},
) {
  let record: BuildRecord
  const pass = {
    setPipeline: (pipeline: unknown) => void record.pipelines.push(pipeline),
    setBindGroup() {},
    dispatchWorkgroups: (...groups: number[]) => void record.dispatches.push(groups),
  } as unknown as GPUComputePassEncoder
  const device = {
    createBindGroup: ({ entries }: GPUBindGroupDescriptor) => (
      record.groups.push([...entries]),
      {}
    ),
  } as unknown as GPUDevice
  const inputs = { texture: hdr, view: {} } as unknown as RadianceInputs
  return (size: [number, number], viewProjection = new Float64Array(16)) => {
    record = { pipelines: [], dispatches: [], groups: [] }
    encodeRadiancePyramid(
      pass,
      device,
      pyramid,
      pipelines as Parameters<typeof encodeRadiancePyramid>[3],
      inputs,
      size,
      viewProjection,
    )
    return record
  }
}

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

/** An image's bilinear read at `uv`, as the sampler reads it, its edge clamped (`bilinearRead`). */
export const bilinear = ({ width, height, texels }: Image, uv: number[]) =>
  [0, 1, 2, 3].map((c) =>
    bilinearRead((i, j) => texels[j * width + i][c], width, height, uv[0] * width, uv[1] * height),
  )

/** The shipped kernels over `finer` into `coarser`, `coarsest`, `drawn` the image's drawn size. A workgroup runs as the device runs it: every thread's tents (`radianceFill`) into
 *  its tile, then — past the barrier — every thread's sum (`radianceSum`) from it. */
export function radianceKernels(drawn: number[]) {
  const binding = { finer: {}, coarser: {}, coarsest: {} }
  const io: Record<keyof typeof binding, Image> = {
    finer: blank(1, 1),
    coarser: blank(1, 1),
    coarsest: blank(1, 1),
  }
  const of = (t: object) =>
    io[(Object.keys(binding) as (keyof typeof binding)[]).find((k) => binding[k] === t)!]
  const tile: number[][] = []
  const run = shaderRun<{
    radianceFill: (lane: number, wg: number[], bounds: number[]) => void
    radianceSum: (lid: number[], wg: number[]) => void
  }>(RADIANCE_SHADER, ['radianceFill', 'radianceSum', 'radianceTent', 'tent'], {
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
  })
  /** The workgroups over `groups` a side, each as the device runs it. */
  const dispatch = (groups: number[], bounds: number[]) => {
    for (let y = 0; y < groups[1]; y++)
      for (let x = 0; x < groups[0]; x++) {
        for (let lane = 0; lane < SIDE * SIDE; lane++) run.radianceFill(lane, [x, y], bounds)
        for (let lane = 0; lane < SIDE * SIDE; lane++)
          run.radianceSum([lane % SIDE, Math.floor(lane / SIDE)], [x, y])
      }
  }
  return {
    /** The first kernel over `source`, in `groups` workgroups a side (the shipped dispatch,
     *  `radianceGroups`, else whole). */
    first(
      source: Image,
      groups = [ceilDiv(source.width, 4 * SIDE), ceilDiv(source.height, 4 * SIDE)],
    ) {
      io.finer = source
      io.coarser = blank(source.width >> 1, source.height >> 1)
      io.coarsest = blank(source.width >> 2, source.height >> 2)
      dispatch(groups, drawn)
      return { coarser: io.coarser, coarsest: io.coarsest }
    },
    down(source: Image) {
      io.finer = source
      io.coarser = blank(source.width >> 1, source.height >> 1)
      io.coarsest = blank(io.coarser.width >> 1, io.coarser.height >> 1)
      dispatch(
        [ceilDiv(io.coarsest.width, SIDE), ceilDiv(io.coarsest.height, SIDE)],
        [source.width, source.height],
      )
      return { coarser: io.coarser, coarsest: io.coarsest }
    },
  }
}
