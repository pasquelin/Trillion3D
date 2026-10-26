import { retire } from '../../gpu/core/frameRetire.ts'
import { HIZ_LEVELS_FRONT_WORD } from '../../visibility/hiz/gpu/levelsUniform.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { SunShadowState } from '../../lighting/distanceField/shadow/state.ts'

/** What the water keeps of the sun's distance-field shadow traced at its depth (`encodeWaterSunFieldShadow`): the
 *  trace's state and mask, the copy of the Hi-Z's levels uniform with its front word up and the depth that names it. */
export interface WaterSun {
  state: SunShadowState
  folded?: { levels: GPUBuffer; one: GPUBuffer; depth?: { over: HizDepth; made: HizDepth } }
}

/**
 * The depth pyramid `depth` with the transparents' front layer folded in, whatever the image's own fold says
 * (`hizFoldTransparents`): its levels uniform copied on the encoder, then the word that says the front layer was
 * written set to one by a copy of a word of one — copies, not a queue write, which would come before the
 * levels' own. The level 0 and the pyramid are the Hi-Z's; the depth is the same object while the Hi-Z's is.
 */
export function foldedDepth(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  held: WaterSun,
  depth: HizDepth,
): HizDepth {
  const hiz = rt.vis.gpuHiz!,
    device = rt.gpu.device!
  const size = hiz.levelTable.size
  if (!held.folded || held.folded.levels.size !== size) {
    if (held.folded) retire(device, held.folded.levels)
    const one =
      held.folded?.one ??
      device.createBuffer({
        label: 'Trillion3D water fold word',
        size: 4,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true,
      })
    if (!held.folded) {
      new Uint32Array(one.getMappedRange())[0] = 1
      one.unmap()
    }
    held.folded = {
      levels: device.createBuffer({
        label: 'Trillion3D water folded levels',
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      one,
    }
  }
  const { levels, one } = held.folded
  encoder.copyBufferToBuffer(hiz.levelTable, 0, levels, 0, size)
  encoder.copyBufferToBuffer(one, 0, levels, HIZ_LEVELS_FRONT_WORD * 4, 4)
  const kept = held.folded.depth
  if (kept?.over === depth) return kept.made
  const made: HizDepth = { resources: [depth.resources[0], depth.resources[1], { buffer: levels }] }
  held.folded.depth = { over: depth, made }
  return made
}

/** Gives the water's sun shadow back, at dispose. */
export function disposeWaterSun(held: WaterSun | undefined) {
  held?.folded?.levels.destroy()
  held?.folded?.one.destroy()
}
