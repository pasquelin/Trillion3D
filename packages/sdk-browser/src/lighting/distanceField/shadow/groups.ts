import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import type { MeshFieldScene } from '../meshFieldScene.ts'
import { DFSH_BINDING as B, DFSH_PARAMS_BYTES } from './layout.ts'
import type { DfshProgram } from './layouts.ts'
import type { DfshPrograms } from './pipelines.ts'
import type { DfshView } from './view.ts'

/** The meshes' fields as the passes bind them (`meshFieldWgsl`, from `B.objects`): the scene's
 *  entries, the generation that says they changed, and the meshes in it. */
type DfshObjects = Pick<MeshFieldScene, 'bindEntries' | 'generation' | 'count'>

/** The groups of the passes, by program. */
export type DfshGroups = Record<DfshProgram, GPUBindGroup>

/**
 * The groups of the three passes that list a sun's meshes by the tiles of its shadow space — the cull, the start offsets and the
 * scatter — over what the view holds and the meshes `objects` name (the surface cache's suns, `lighting/surfaceCache/lighting/meshShadow.ts`).
 * Made at each call: a sun's pass is one a frame.
 */
export function dfshLightGroups(
  device: GPUDevice,
  programs: DfshPrograms,
  view: DfshView,
  objects: DfshObjects,
): DfshGroups {
  const entries = objects.bindEntries(B.objects)
  const named = (resources: Partial<Record<keyof typeof B, GPUBindingResource>>) =>
    namedEntries(B, resources)
  const light = named({ params: { buffer: view.params, size: DFSH_PARAMS_BYTES } })
  const group = (name: 'cull' | 'offsets' | 'scatter', ...parts: GPUBindGroupEntry[][]) =>
    device.createBindGroup({
      label: `Trillion3D light distance-field shadow ${name}`,
      layout: programs.layouts[name],
      entries: parts.flat(),
    })
  const tiles = {
    tileCounts: wholeBuffer(view.tileCounts),
    tileOffsets: wholeBuffer(view.tileOffsets),
    tileData: wholeBuffer(view.tileData),
  }
  const culled = { culledObjects: wholeBuffer(view.culledObjects) }
  return {
    cull: group(
      'cull',
      light,
      entries.slice(1, 3),
      named({ ...culled, objectArgs: wholeBuffer(view.objectArgs) }),
    ),
    offsets: group(
      'offsets',
      light,
      named({
        tileCounts: tiles.tileCounts,
        tileOffsets: tiles.tileOffsets,
        nextOffset: wholeBuffer(view.nextOffset),
      }),
    ),
    scatter: group('scatter', light, entries.slice(2, 3), named({ ...culled, ...tiles })),
  }
}
