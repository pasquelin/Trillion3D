import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { globalReadLayoutEntries } from '../view.ts'
import { sceneLayoutEntries } from '../sceneBindings.ts'
import { hizDepthEntries } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { DFAO_BENT_FORMAT, DFAO_BINDING as B, DFAO_PARAMS_BYTES } from './layout.ts'

/** The stages a binding is seen by (`GPUShaderStage`, written in the clear: the entries are read from Node too). */
const COMPUTE = 4
const VERTEX = 1
const FRAGMENT = 2

type Name = Exclude<keyof typeof B, 'field' | 'objects'>

const params = (stage = COMPUTE) =>
  computeUniformEntry(B.params, { minBindingSize: DFAO_PARAMS_BYTES }, stage)
const buffer = (name: Name, type: GPUBufferBindingType, stage = COMPUTE) =>
  computeBufferEntry(B[name], type, stage)
const read = (name: Name, stage = COMPUTE) => buffer(name, 'read-only-storage', stage)
const write = (name: Name, stage = COMPUTE) => buffer(name, 'storage', stage)
const texture = (
  name: Name,
  sample: GPUTextureSampleType = 'unfilterable-float',
  stage = COMPUTE,
) => computeTextureEntry(B[name], sample, '2d', stage)
const store = (name: Name) => computeStorageTextureEntry(B[name], DFAO_BENT_FORMAT)

/** The meshes' fields' bindings (`meshFieldWgsl`, from `B.objects`) the stage `stage` reads: all of them, or only the
 *  bounds and the data. */
const objectEntries = (all: boolean, stage = COMPUTE): GPUBindGroupLayoutEntry[] => {
  const entries = sceneLayoutEntries(B.objects, stage)
  return all ? entries : entries.slice(1, 3)
}

/**
 * THE LAYOUTS OF THE OCCLUSION'S PROGRAMS' GROUP 0, one per program (`DFAO_PROGRAMS`), each the bindings the program
 * names. The scatter's draw sees its bindings from the stage that reads them: the vertex stage the list of meshes and
 * their bounds, the fragment stage the rest.
 */
export const DFAO_LAYOUTS = {
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
    ...globalReadLayoutEntries(B.field),
  ],
  coneObjects: [
    params(),
    texture('normals'),
    write('visibility'),
    read('tileData'),
    ...objectEntries(true),
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
  cullObjects: [params(), ...objectEntries(false), write('culledObjects'), write('objectArgs')],
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
    ...objectEntries(false, VERTEX).slice(0, 1),
    read('tileAxis', FRAGMENT),
    read('tileRanges', FRAGMENT),
    write('tileCounts', FRAGMENT),
    read('tileOffsets', FRAGMENT),
    write('tileData', FRAGMENT),
    ...objectEntries(true, FRAGMENT).filter((entry) => entry.binding !== B.objects + 1),
  ],
} as const satisfies Record<string, readonly GPUBindGroupLayoutEntry[]>

/** A program of the occlusion. */
export type DfaoProgram = keyof typeof DFAO_LAYOUTS
