import { COMPUTE, computeUniformEntry, storageEntries } from '../../../gpu/core/computeBindings.ts'
import { sceneLayoutEntries, sceneObjectEntries } from '../sceneBindings.ts'
import { DFSH_BINDING as B, DFSH_PARAMS_BYTES } from './layout.ts'

/** The stages the scatter's bindings are seen by (`GPUShaderStage`, written in the clear: the entries
 *  are read from Node too). */
const VERTEX = 1
const FRAGMENT = 2

type Name = Exclude<keyof typeof B, 'objects'>

/** A sun's uniform, read at the offset of its block: one binding, a dynamic offset a sun. */
const params = (stage = COMPUTE) =>
  computeUniformEntry(
    B.params,
    { hasDynamicOffset: true, minBindingSize: DFSH_PARAMS_BYTES },
    stage,
  )
const { read, write } = storageEntries<Name>(B)

/**
 * THE LAYOUTS OF THE SUNS' MESH LISTS PROGRAMS' GROUP 0, one per program (`DFSH_SHADERS`), each the
 * bindings the program names. The scatter's draw sees the list of meshes from the vertex stage, the
 * meshes' data from both its stages and the tiles' lists from the fragment stage.
 */
export const DFSH_LAYOUTS = {
  cull: [
    params(),
    ...sceneObjectEntries(B.objects, false),
    write('culledObjects'),
    write('objectArgs'),
  ],
  offsets: [params(), read('tileCounts'), write('tileOffsets'), write('nextOffset')],
  scatter: [
    params(VERTEX | FRAGMENT),
    read('culledObjects', VERTEX),
    ...sceneLayoutEntries(B.objects, VERTEX | FRAGMENT).slice(2, 3),
    write('tileCounts', FRAGMENT),
    read('tileOffsets', FRAGMENT),
    write('tileData', FRAGMENT),
  ],
} as const satisfies Record<string, readonly GPUBindGroupLayoutEntry[]>

/** A program of the suns' mesh lists. */
export type DfshProgram = keyof typeof DFSH_LAYOUTS
