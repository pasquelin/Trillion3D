import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { hizDepthBindEntries } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../../visibility/hiz/gpu/types.ts'
import type { MeshFieldScene } from '../meshFieldScene.ts'
import { DFSH_BINDING as B, DFSH_PARAMS_BYTES } from './layout.ts'
import type { DfshProgram } from './layouts.ts'
import type { DfshPrograms } from './pipelines.ts'
import type { DfshView } from './view.ts'

/** The meshes' fields as the passes bind them (`meshFieldWgsl`, from `B.objects`): the scene's
 *  entries, the generation that says they changed, and the meshes in it. */
type DfshObjects = Pick<MeshFieldScene, 'bindEntries' | 'generation' | 'count'>

/** What the passes of an image read of the frame. */
export interface DfshSources {
  depth: HizDepth
  /** The surfaces' flags (`texture_2d<u32>`), per pixel. */
  flags: GPUTextureView
  objects: DfshObjects
}

/** The groups of the passes, by program. */
export type DfshGroups = Record<DfshProgram, GPUBindGroup>

/** The groups of the passes over what the view holds and `sources` name. The uniform is bound at its
 *  first block's size: a pass reads a light's block at that light's offset. */
function makeGroups(
  device: GPUDevice,
  programs: DfshPrograms,
  view: DfshView,
  sources: DfshSources,
): DfshGroups {
  const objects = sources.objects.bindEntries(B.objects)
  const group = (name: DfshProgram, ...entries: GPUBindGroupEntry[][]) =>
    device.createBindGroup({
      label: `Trillion3D sun distance-field shadow ${name}`,
      layout: programs.layouts[name],
      entries: entries.flat(),
    })
  const named = (resources: Partial<Record<keyof typeof B, GPUBindingResource>>) =>
    namedEntries(B, resources)
  const light = named({ params: { buffer: view.params, size: DFSH_PARAMS_BYTES } })
  const depth = hizDepthBindEntries(B.depth, sources.depth)
  const tiles = {
    tileCounts: wholeBuffer(view.tileCounts),
    tileOffsets: wholeBuffer(view.tileOffsets),
    tileData: wholeBuffer(view.tileData),
  }
  const culled = { culledObjects: wholeBuffer(view.culledObjects) }
  const half = { half: view.half.view }
  const finals = { mask: wholeBuffer(view.mask), final: wholeBuffer(view.final) }
  const args = { objectArgs: wholeBuffer(view.objectArgs) }
  const counted = { tileCounts: tiles.tileCounts, tileOffsets: tiles.tileOffsets }
  return {
    cull: group('cull', light, objects.slice(1, 3), named({ ...culled, ...args })),
    offsets: group(
      'offsets',
      light,
      named({ ...counted, nextOffset: wholeBuffer(view.nextOffset) }),
    ),
    scatter: group('scatter', light, objects.slice(2, 3), named({ ...culled, ...tiles })),
    trace: group(
      'trace',
      light,
      depth,
      named({ ...tiles, ...half, flags: sources.flags }),
      objects,
    ),
    final: group('final', depth, named({ ...half, ...finals })),
  }
}

/** What a view's groups were made over, to know again. */
interface GroupsKept {
  over: unknown[]
  made: DfshGroups
}

/**
 * The groups of the image's passes over `sources`: kept on the view while what they name is the
 * same (the depth's resources, the meshes' scene generation, the view), made again where a
 * source moved.
 */
export function dfshGroups(
  device: GPUDevice,
  programs: DfshPrograms,
  view: DfshView,
  sources: DfshSources,
) {
  const over = [sources.depth, sources.flags, sources.objects.generation, view]
  const held = view.groups as GroupsKept | undefined
  if (held && sameValues(held.over, over)) return held.made
  const made = makeGroups(device, programs, view, sources)
  view.groups = { over, made } satisfies GroupsKept
  return made
}
