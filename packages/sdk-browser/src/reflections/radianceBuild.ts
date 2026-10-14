import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { levelViews } from '../texture/mipGroups.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { REFLECTION_SIDE } from './constants.ts'
import type { RadiancePyramid, RadianceStages } from './radiance.ts'

/** What a build reads and writes beyond the pyramid: the frame's HDR target — its level 0 the lit
 *  image, its mips the levels the build writes —, the lighting's view uniform, and the buffer that
 *  holds the image's hash (`settle.ts`). */
export type RadianceInputs = { texture: GPUTexture; view: GPUBuffer; hash: GPUBuffer }

/** The bind groups of a build over `inputs`: the first dispatch's, then one for each two levels
 *  after, and the roll of the hash. Level `k` is the HDR target's mip `k`, each bound alone: a
 *  dispatch reads one and writes the two after it. */
function buildGroups(
  device: GPUDevice,
  pyramid: RadiancePyramid,
  { firstLayout, downLayout, rollLayout }: RadianceStages,
  inputs: RadianceInputs,
) {
  const { sampler } = pyramid,
    views = levelViews(inputs.texture)
  const groups = [
    device.createBindGroup({
      layout: firstLayout,
      entries: sequentialEntries([
        views[0],
        views[1],
        views[2],
        sampler,
        pyramid.image.view,
        { buffer: inputs.view },
        { buffer: inputs.hash },
      ]),
    }),
  ]
  for (let at = 2; at + 2 < pyramid.levels; at += 2)
    groups.push(
      device.createBindGroup({
        layout: downLayout,
        entries: sequentialEntries([views[at], views[at + 1], views[at + 2], sampler]),
      }),
    )
  const roll = device.createBindGroup({
    layout: rollLayout,
    entries: sequentialEntries([{ buffer: inputs.hash }], 6),
  })
  return { groups, roll }
}

/** The threads a side of the dispatch that makes level `level` of an image drawn `drawn` wide, in
 *  a pyramid of `extent`: its texels the drawn image covers, and the two beyond it that a
 *  footprint's cubic read reaches, none past the texels the image would hold if its extent were
 *  not cut down at the level (a thread owns the `2^level` pixels of its texel). */
const radianceThreads = (drawn: number, level: number, extent: number) =>
  Math.min(ceilDiv(drawn, 2 ** level) + 2, ceilDiv(extent, 2 ** level))

/** The workgroups of the dispatch that makes level `level` of an image drawn `size`, in a pyramid
 *  of `extent`. */
const radianceGroups = (
  size: readonly [number, number],
  level: number,
  extent: readonly [number, number],
) => [
  ceilDiv(radianceThreads(size[0], level, extent[0]), REFLECTION_SIDE),
  ceilDiv(radianceThreads(size[1], level, extent[1]), REFLECTION_SIDE),
]

/**
 * The radiance pyramid of the lit image in `inputs.texture`, drawn at `size` with `viewProjection`, in the
 * open compute `pass`: the hash of the last image moved aside, levels 1 and 2 from the image and
 * its hash, then two levels a dispatch from the last made (`RADIANCE_SHADER`); what the pyramid
 * holds is then that image, for the next one's reflections, its level 0 the lit image itself once
 * the image is encoded (`fresh`, `adoptRadianceImage`). `inputs.view` is the lighting's view, whose
 * drawn size the first dispatch reads. With `hashless` — a settled view, whose hash no sample reads
 * (`settle.verified`) — the image is not hashed: the next image that is hashes the one before it too.
 */
export function encodeRadiancePyramid(
  pass: GPUComputePassEncoder,
  device: GPUDevice,
  pyramid: RadiancePyramid,
  pipelines: RadianceStages,
  inputs: RadianceInputs,
  size: readonly [number, number],
  viewProjection: ArrayLike<number>,
  hashless = false,
) {
  const { levels, held, build } = pyramid
  if (levels < 3) return
  const { next } = build.identity
  next[0] = inputs.texture
  next[1] = inputs.view
  next[2] = inputs.hash
  next[3] = pipelines
  next[4] = pyramid.image.view
  next.length = 5
  const moved = build.identity.moved(),
    slot = build.identity.slot
  if (moved || !build.slots[slot])
    build.slots[slot] = buildGroups(device, pyramid, pipelines, inputs)
  const { groups, roll } = build.slots[slot]!
  // Drawn from where the image before it was: hashed, and the image before it too where that one
  // moved or was settled and hashed nothing — still whole, the pyramid's level 0.
  const hashedBefore = pyramid.hashed,
    still =
      held.valid &&
      held.size[0] === size[0] &&
      held.size[1] === size[1] &&
      sameElements(held.viewProjection, viewProjection),
    hashing = still && !hashless
  const first = !hashing
    ? pipelines.firstPipeline
    : hashedBefore
      ? pipelines.firstHashedPipeline
      : pipelines.firstBothPipeline
  pass.setPipeline(pipelines.rollPipeline)
  pass.setBindGroup(0, roll)
  pass.dispatchWorkgroups(1)
  for (let at = 0; at < groups.length; at++) {
    const [x, y] = radianceGroups(size, 2 * at + 2, [pyramid.width, pyramid.height])
    pass.setBindGroup(0, groups[at])
    pass.setPipeline(at === 0 ? first : pipelines.downPipeline)
    pass.dispatchWorkgroups(x, y)
  }
  held.still = still
  pyramid.hashed = hashing
  held.valid = true
  copyMatrix4(held.viewProjection, viewProjection)
  held.size[0] = size[0]
  held.size[1] = size[1]
  pyramid.fresh = true
}
