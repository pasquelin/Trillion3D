import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  storageEntries,
} from '../../../gpu/core/computeBindings.ts'
import { globalReadLayoutEntries } from '../view.ts'
import { sceneObjectEntries } from '../sceneBindings.ts'
import { hizDepthEntries } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { DFAO_BENT_FORMAT, DFAO_BINDING as B, DFAO_PARAMS_BYTES } from './layout.ts'

/** The stages a binding is seen by (`GPUShaderStage`, written in the clear: the entries are read from Node too). */
const COMPUTE = 4
const VERTEX = 1
const FRAGMENT = 2

type Name = Exclude<keyof typeof B, 'field' | 'objects'>

const params = (stage = COMPUTE) =>
  computeUniformEntry(B.params, { minBindingSize: DFAO_PARAMS_BYTES }, stage)
const { read, write } = storageEntries<Name>(B)
const texture = (
  name: Name,
  sample: GPUTextureSampleType = 'unfilterable-float',
  stage = COMPUTE,
) => computeTextureEntry(B[name], sample, '2d', stage)
const store = (name: Name) => computeStorageTextureEntry(B[name], DFAO_BENT_FORMAT)

/**
 * THE LAYOUTS OF THE OCCLUSION'S PROGRAMS' GROUP 0, one per program (`DFAO_PROGRAMS`), each the bindings the program
 * names. The scatter's draw sees its bindings from the stage that reads them: the vertex stage the list of meshes and
 * their bounds, the fragment stage the rest. `filterableMip` is whether the cones against the global field read its coarse mip
 * through the hardware's filter (`dfaoConeGlobalShader`).
 */
const dfaoLayouts = (filterableMip: boolean) => ({
  normals: [
    params(),
    ...hizDepthEntries(B.depth, COMPUTE),
    texture('surfaceNormals'),
    store('output'),
  ],
  clear: [params(), write('visibility')],
  coneGlobal: [
    params(),
    texture('normals'),
    write('visibility'),
    ...globalReadLayoutEntries(B.field, filterableMip),
  ],
  coneObjects: [
    params(),
    texture('normals'),
    write('visibility'),
    read('tileData'),
    ...sceneObjectEntries(B.objects, true),
  ],
  combine: [params(), texture('normals'), read('visibility'), store('output')],
  upsampleOnly: [params(), texture('normals'), texture('bent'), store('output')],
  updateHistory: [
    params(),
    texture('normals'),
    texture('bent'),
    texture('history', 'float'),
    computeSamplerEntry(B.sampler, 'filtering'),
    texture('vectors', 'uint'),
    store('output'),
  ],
  filterHistory: [params(), texture('bent'), store('output')],
  pack: [params(), texture('history'), write('packed')],
  cullObjects: [
    params(),
    ...sceneObjectEntries(B.objects, false),
    write('culledObjects'),
    write('objectArgs'),
  ],
  tileCones: [params(), texture('normals'), write('tileAxis'), write('tileRanges')],
  startOffsets: [
    params(),
    read('objectArgs'),
    read('tileCounts'),
    write('tileOffsets'),
    write('tileData'),
    write('tileArgs'),
  ],
  scatter: [
    params(VERTEX | FRAGMENT),
    read('culledObjects', VERTEX),
    ...sceneObjectEntries(B.objects, false, VERTEX).slice(0, 1),
    read('tileAxis', FRAGMENT),
    read('tileRanges', FRAGMENT),
    write('tileCounts', FRAGMENT),
    read('tileOffsets', FRAGMENT),
    write('tileData', FRAGMENT),
    ...sceneObjectEntries(B.objects, true, FRAGMENT).filter(
      (entry) => entry.binding !== B.objects + 1,
    ),
  ],
}) as const satisfies Record<string, readonly GPUBindGroupLayoutEntry[]>

const layoutsHeld = new Map<boolean, ReturnType<typeof dfaoLayouts>>()
/** The layouts of the programs, made once for each value of `filterableMip`. */
export const dfaoLayoutsOf = (filterableMip: boolean) => {
  let held = layoutsHeld.get(filterableMip)
  if (!held) layoutsHeld.set(filterableMip, (held = dfaoLayouts(filterableMip)))
  return held
}

/** The layouts with the coarse mip read by hand. */
export const DFAO_LAYOUTS = dfaoLayoutsOf(false)

/** A program of the occlusion. */
export type DfaoProgram = keyof typeof DFAO_LAYOUTS
