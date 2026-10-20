import { namedEntries } from '../gpu/core/computeBindings.ts'
import { levelViews } from '../texture/mipGroups.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { REFLECTION_SIDE } from './constants.ts'
import type { RadiancePyramid, RadianceStages } from './radiance.ts'
import { RADIANCE_BINDINGS } from './radianceWgsl.ts'

/** What a build reads and writes beyond the pyramid: the frame's HDR target — its level 0 the lit
 *  image, its mips the levels the build writes — and the lighting's view uniform. */
export type RadianceInputs = { texture: GPUTexture; view: GPUBuffer }

/** The bind groups of a build over `inputs`: the first dispatch's, then one for each two levels
 *  after. Level `k` is the HDR target's mip `k`, each bound alone: a dispatch reads one and writes
 *  the two after it. */
function buildGroups(
  device: GPUDevice,
  pyramid: RadiancePyramid,
  { firstLayout, downLayout }: RadianceStages,
  inputs: RadianceInputs,
) {
  const { sampler } = pyramid,
    views = levelViews(inputs.texture)
  const groups = [
    device.createBindGroup({
      layout: firstLayout,
      entries: namedEntries(RADIANCE_BINDINGS, {
        finer: views[0],
        coarser: views[1],
        coarsest: views[2],
        halves: sampler,
        view: { buffer: inputs.view },
      }),
    }),
  ]
  for (let at = 2; at + 2 < pyramid.levels; at += 2)
    groups.push(
      device.createBindGroup({
        layout: downLayout,
        entries: namedEntries(RADIANCE_BINDINGS, {
          finer: views[at],
          coarser: views[at + 1],
          coarsest: views[at + 2],
          halves: sampler,
        }),
      }),
    )
  return groups
}

/** The threads a side of the dispatch that makes level `level` of an image drawn `drawn` wide, in
 *  a pyramid of `extent`: its texels the drawn image covers, and the two beyond it that a
 *  footprint's cubic read reaches, none past the texels the image would hold if its extent were
 *  not cut down at the level (a thread owns the `2^level` pixels of its texel). */
const radianceThreads = (drawn: number, level: number, extent: number) =>
  Math.min(ceilDiv(drawn, 2 ** level) + 2, ceilDiv(extent, 2 ** level))

/** The workgroups of a dispatch, written in place each one (`radianceGroups`). */
const dispatched: [number, number] = [0, 0]

/** The workgroups of the dispatch that makes level `level` of an image drawn `size`, in a pyramid
 *  of `width × height`, written into `dispatched`. */
const radianceGroups = (
  size: readonly [number, number],
  level: number,
  width: number,
  height: number,
) => {
  dispatched[0] = ceilDiv(radianceThreads(size[0], level, width), REFLECTION_SIDE)
  dispatched[1] = ceilDiv(radianceThreads(size[1], level, height), REFLECTION_SIDE)
  return dispatched
}

/**
 * The radiance pyramid of the lit image in `inputs.texture`, drawn at `size` with `viewProjection`, in the
 * open compute `pass`: levels 1 and 2 from the image, then two levels a dispatch from the last made
 * (`RADIANCE_SHADER`); what the pyramid holds is then that image, for the next one's reflections, its
 * level 0 the lit image itself once the image is encoded (`fresh`, `adoptRadianceImage`).
 * `inputs.view` is the lighting's view, whose drawn size the first dispatch reads.
 */
export function encodeRadiancePyramid(
  pass: GPUComputePassEncoder,
  device: GPUDevice,
  pyramid: RadiancePyramid,
  pipelines: RadianceStages,
  inputs: RadianceInputs,
  size: readonly [number, number],
  viewProjection: ArrayLike<number>,
) {
  const { levels, held, build } = pyramid
  if (levels < 3) return
  const { next } = build.identity
  next[0] = inputs.texture
  next[1] = inputs.view
  next[2] = pipelines
  next.length = 3
  const moved = build.identity.moved(),
    slot = build.identity.slot
  if (moved || !build.slots[slot])
    build.slots[slot] = buildGroups(device, pyramid, pipelines, inputs)
  const groups = build.slots[slot]!
  for (let at = 0; at < groups.length; at++) {
    const [x, y] = radianceGroups(size, 2 * at + 2, pyramid.width, pyramid.height)
    pass.setBindGroup(0, groups[at])
    pass.setPipeline(at === 0 ? pipelines.firstPipeline : pipelines.downPipeline)
    pass.dispatchWorkgroups(x, y)
  }
  held.valid = true
  copyMatrix4(held.viewProjection, viewProjection)
  held.size[0] = size[0]
  held.size[1] = size[1]
  pyramid.fresh = true
}
